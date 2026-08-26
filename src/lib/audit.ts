import type { Transaction } from "dexie";
import { db } from "@/lib/db";
import type { AuditActionType, AuditEntityType, AuditLogEntry } from "@/lib/types";
import { newId, nowIso } from "@/lib/ids";

/**
 * Audit trail writer (module 8). Entries are append-only: nothing in the app
 * updates or deletes an AuditLogEntry, which is what makes the trail defensible.
 *
 * `isManualOverride` marks actions a human forced against what the data implies
 * — e.g. marking an invoice Paid with no covering remittance — so a reviewer can
 * filter for them without reading every row (US-2).
 */
export async function recordAudit(
  input: {
    actionType: AuditActionType;
    entityType: AuditEntityType;
    entityId: string;
    summary: string;
    isManualOverride?: boolean;
    before?: unknown;
    after?: unknown;
  },
  tx: Transaction | null = null
): Promise<void> {
  const entry: AuditLogEntry = {
    id: newId(),
    timestamp: nowIso(),
    actionType: input.actionType,
    entityType: input.entityType,
    entityId: input.entityId,
    isManualOverride: input.isManualOverride ?? false,
    summary: input.summary,
    before: input.before,
    after: input.after,
  };
  const table = tx ? tx.table<AuditLogEntry>("auditLog") : db.auditLog;
  await table.add(entry);
}

export const AUDIT_ACTION_LABELS: Record<AuditActionType, string> = {
  invoice_created: "Invoice created",
  invoice_updated: "Invoice updated",
  invoice_deleted: "Invoice deleted",
  invoice_status_changed: "Invoice status changed",
  invoice_status_overridden: "Invoice status overridden",
  remittance_recorded: "Remittance recorded",
  invoice_pdf_downloaded: "Invoice PDF downloaded",
  client_created: "Client created",
  client_updated: "Client updated",
  client_archived: "Client archived",
  expense_recorded: "Expense recorded",
  entity_profile_updated: "Entity profile updated",
  currency_settings_changed: "Currency settings changed",
  data_imported: "Backup imported",
};
