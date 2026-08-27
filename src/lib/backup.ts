import { db } from "@/lib/db";
import type {
  AuditLogEntry,
  Client,
  ClientDocument,
  Counter,
  Currency,
  EntityProfile,
  ExpenseCategory,
  ExpenseEntry,
  Invoice,
  LedgerEntry,
  Remittance,
} from "@/lib/types";
import { nowIso } from "@/lib/ids";
import { reconcileCounters } from "@/lib/serial";
import { recordAudit } from "@/lib/audit";

/**
 * Whole-database export/import.
 *
 * IndexedDB is the source of truth (CLAUDE.md) and it lives in one browser
 * profile — clearing site data, switching devices, or a reinstalled OS takes the
 * books with it. GCS backup covers invoice PDFs only, not the ledger, so this
 * JSON file is the actual disaster-recovery path. It needs no network, no
 * account, and no free-tier budget.
 */

/**
 * 2 adds `clientDocuments`. A version-1 file still imports — it simply carries no
 * documents — but a version-2 file cannot be read by an older build, which is
 * what `parseBackup` refuses on.
 */
export const BACKUP_FORMAT_VERSION = 2;

/**
 * A client document with its bytes base64-encoded, because JSON cannot hold a
 * Blob. This is why documents are size-capped on upload: they inflate by a third
 * here, and this file is the only disaster-recovery path there is.
 */
export type SerializedClientDocument = Omit<ClientDocument, "file"> & { fileBase64: string };

export interface BackupFile {
  format: "vrikshafx-backup";
  version: number;
  exportedAt: string;
  data: {
    currencies: Currency[];
    entityProfile: EntityProfile[];
    counters: Counter[];
    clients: Client[];
    clientDocuments?: SerializedClientDocument[];
    invoices: Invoice[];
    remittances: Remittance[];
    expenseCategories: ExpenseCategory[];
    expenseEntries: ExpenseEntry[];
    ledgerEntries: LedgerEntry[];
    auditLog: AuditLogEntry[];
  };
}

export async function exportBackup(): Promise<BackupFile> {
  const [
    currencies,
    entityProfile,
    counters,
    clients,
    clientDocuments,
    invoices,
    remittances,
    expenseCategories,
    expenseEntries,
    ledgerEntries,
    auditLog,
  ] = await Promise.all([
    db.currencies.toArray(),
    db.entityProfile.toArray(),
    db.counters.toArray(),
    db.clients.toArray(),
    db.clientDocuments.toArray(),
    db.invoices.toArray(),
    db.remittances.toArray(),
    db.expenseCategories.toArray(),
    db.expenseEntries.toArray(),
    db.ledgerEntries.toArray(),
    db.auditLog.toArray(),
  ]);

  return {
    format: "vrikshafx-backup",
    version: BACKUP_FORMAT_VERSION,
    exportedAt: nowIso(),
    data: {
      currencies,
      entityProfile,
      counters,
      clients,
      clientDocuments: await Promise.all(clientDocuments.map(serializeDocument)),
      invoices,
      remittances,
      expenseCategories,
      expenseEntries,
      ledgerEntries,
      auditLog,
    },
  };
}

async function serializeDocument(document: ClientDocument): Promise<SerializedClientDocument> {
  const { file, ...rest } = document;
  return { ...rest, fileBase64: await blobToBase64(file) };
}

function deserializeDocument(document: SerializedClientDocument): ClientDocument {
  const { fileBase64, ...rest } = document;
  return { ...rest, file: base64ToBlob(fileBase64, rest.mimeType) };
}

/**
 * Chunked rather than `String.fromCharCode(...bytes)`: spreading a multi-megabyte
 * array into a call blows the argument limit and throws.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function backupFileName(exportedAt = nowIso()): string {
  return `vrikshafx-backup-${exportedAt.slice(0, 10)}.json`;
}

export function parseBackup(raw: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  const candidate = parsed as Partial<BackupFile>;
  if (candidate?.format !== "vrikshafx-backup" || !candidate.data) {
    throw new Error("That file is not a VrikshaFX backup.");
  }
  if (typeof candidate.version !== "number" || candidate.version > BACKUP_FORMAT_VERSION) {
    throw new Error(
      "That backup was written by a newer version of VrikshaFX. Update the app before importing it."
    );
  }
  return candidate as BackupFile;
}

export interface ImportSummary {
  [table: string]: number;
}

/**
 * Replaces the entire local database with the backup's contents. This is a
 * restore, not a merge: merging two divergent ledgers would produce duplicated
 * postings and colliding invoice serials, and there is no correct way to
 * reconcile them automatically. The caller must confirm with the user first.
 */
export async function importBackup(backup: BackupFile): Promise<ImportSummary> {
  const { data } = backup;
  const summary: ImportSummary = {};

  await db.transaction(
    "rw",
    [
      db.currencies,
      db.entityProfile,
      db.counters,
      db.clients,
      db.clientDocuments,
      db.invoices,
      db.remittances,
      db.expenseCategories,
      db.expenseEntries,
      db.ledgerEntries,
      db.auditLog,
    ],
    async () => {
      const tables = [
        [db.currencies, data.currencies, "currencies"],
        [db.entityProfile, data.entityProfile, "entityProfile"],
        [db.counters, data.counters, "counters"],
        [db.clients, data.clients, "clients"],
        [db.clientDocuments, (data.clientDocuments ?? []).map(deserializeDocument), "clientDocuments"],
        [db.invoices, data.invoices, "invoices"],
        [db.remittances, data.remittances, "remittances"],
        [db.expenseCategories, data.expenseCategories, "expenseCategories"],
        [db.expenseEntries, data.expenseEntries, "expenseEntries"],
        [db.ledgerEntries, data.ledgerEntries, "ledgerEntries"],
        [db.auditLog, data.auditLog, "auditLog"],
      ] as const;

      for (const [table, rows, name] of tables) {
        await table.clear();
        const items = rows ?? [];
        if (items.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (table as any).bulkPut(items);
        }
        summary[name] = items.length;
      }
    }
  );

  // Backups written before counters existed carry invoices but no sequence rows;
  // without this the next invoice would reuse a serial already in the file.
  await reconcileCounters();

  await recordAudit({
    actionType: "data_imported",
    entityType: "settings",
    entityId: "backup",
    summary: `Restored backup from ${backup.exportedAt.slice(0, 10)} — local data replaced`,
    isManualOverride: true,
    after: summary,
  });

  return summary;
}

/** Triggers a browser download of a JSON blob, with no network involved. */
export function downloadJson(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
