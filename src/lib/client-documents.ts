import { db } from "@/lib/db";
import type { ClientDocument, ClientDocumentKind, ContractAnalysis } from "@/lib/types";
import { newId, nowIso } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { enqueueSync } from "@/lib/sync";

/**
 * Contracts, NDAs, SOWs, and POs attached to a client.
 *
 * The file is stored as a Blob in IndexedDB rather than uploaded anywhere: it is
 * available offline like the rest of the books, and an NDA never leaves the
 * device. GCS sync (module 2) covers invoice PDFs — signed paper is the user's
 * own document and does not belong in a bucket unless they ask.
 */

export const DOCUMENT_KIND_LABELS: Record<ClientDocumentKind, string> = {
  nda: "NDA",
  msa: "Master Services Agreement",
  sow: "Statement of Work",
  po: "Purchase Order",
  other: "Other document",
};

export interface AttachDocumentInput {
  clientId: string;
  kind: ClientDocumentKind;
  file: File;
  analysis?: ContractAnalysis;
  notes?: string;
}

export async function attachClientDocument(input: AttachDocumentInput): Promise<ClientDocument> {
  const document: ClientDocument = {
    id: newId(),
    clientId: input.clientId,
    kind: input.kind,
    fileName: input.file.name,
    mimeType: input.file.type || "application/octet-stream",
    size: input.file.size,
    // Copied into a plain Blob: a File holds a handle on something the user can
    // move or delete, and IndexedDB must own its own bytes.
    file: new Blob([await input.file.arrayBuffer()], {
      type: input.file.type || "application/octet-stream",
    }),
    uploadedAt: nowIso(),
    analysis: input.analysis,
    notes: input.notes,
  };

  await db.transaction("rw", db.clientDocuments, db.auditLog, db.syncQueue, async (tx) => {
    await db.clientDocuments.add(document);
    await enqueueSync(tx, "clientDocuments", document.id);
    await recordAudit(
      {
        actionType: "client_document_uploaded",
        entityType: "client_document",
        entityId: document.id,
        summary: `${DOCUMENT_KIND_LABELS[document.kind]} "${document.fileName}" attached`,
        after: { ...document, file: undefined },
      },
      tx
    );
  });

  return document;
}

export async function deleteClientDocument(id: string): Promise<void> {
  await db.transaction("rw", db.clientDocuments, db.auditLog, db.syncQueue, async (tx) => {
    const document = await db.clientDocuments.get(id);
    if (!document) return;

    await db.clientDocuments.delete(id);
    await enqueueSync(tx, "clientDocuments", id);
    await recordAudit(
      {
        actionType: "client_document_deleted",
        entityType: "client_document",
        entityId: id,
        summary: `${DOCUMENT_KIND_LABELS[document.kind]} "${document.fileName}" deleted`,
        isManualOverride: true,
        before: { ...document, file: undefined },
      },
      tx
    );
  });
}

export async function documentsForClient(clientId: string): Promise<ClientDocument[]> {
  const documents = await db.clientDocuments.where("clientId").equals(clientId).toArray();
  return documents.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** Hands the stored file back to the user. Object URL only — nothing is fetched. */
export function downloadClientDocument(document: ClientDocument): void {
  const url = URL.createObjectURL(document.file);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = document.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
