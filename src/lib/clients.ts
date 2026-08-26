import { db } from "@/lib/db";
import type { Client, ClientSnapshot } from "@/lib/types";
import { newId, nowIso } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";

export type ClientInput = ClientSnapshot;

export async function createClient(input: ClientInput): Promise<Client> {
  const timestamp = nowIso();
  const client: Client = { ...input, id: newId(), archived: false, createdAt: timestamp, updatedAt: timestamp };

  await db.transaction("rw", db.clients, db.auditLog, async (tx) => {
    await db.clients.add(client);
    await recordAudit(
      {
        actionType: "client_created",
        entityType: "client",
        entityId: client.id,
        summary: `${client.name} (${client.country}) added`,
        after: client,
      },
      tx
    );
  });

  return client;
}

/**
 * Edits a client. Invoices already issued to them are untouched: each carries
 * its own `clientSnapshot` taken at creation time, so a corrected address never
 * silently rewrites a PDF that has already gone to the client (module 5, US-1).
 */
export async function updateClient(id: string, input: ClientInput): Promise<void> {
  await db.transaction("rw", db.clients, db.auditLog, async (tx) => {
    const before = await db.clients.get(id);
    if (!before) throw new Error("Client no longer exists.");

    const after: Client = { ...before, ...input, updatedAt: nowIso() };
    await db.clients.put(after);

    await recordAudit(
      {
        actionType: "client_updated",
        entityType: "client",
        entityId: id,
        summary: `${after.name} updated — existing invoices keep their original details`,
        before,
        after,
      },
      tx
    );
  });
}

export async function invoiceCountForClient(clientId: string): Promise<number> {
  return db.invoices.where("clientId").equals(clientId).count();
}

/**
 * Removes a client. One with invoices is archived rather than deleted, so the
 * historical records it is referenced by stay intact; one with none is deleted
 * outright since nothing depends on it.
 */
export async function removeClient(id: string): Promise<"archived" | "deleted"> {
  return db.transaction("rw", db.clients, db.invoices, db.auditLog, async (tx) => {
    const client = await db.clients.get(id);
    if (!client) return "deleted";

    const invoiceCount = await db.invoices.where("clientId").equals(id).count();

    if (invoiceCount === 0) {
      await db.clients.delete(id);
      await recordAudit(
        {
          actionType: "client_archived",
          entityType: "client",
          entityId: id,
          summary: `${client.name} deleted (no invoices)`,
          isManualOverride: true,
          before: client,
        },
        tx
      );
      return "deleted";
    }

    await db.clients.put({ ...client, archived: true, updatedAt: nowIso() });
    await recordAudit(
      {
        actionType: "client_archived",
        entityType: "client",
        entityId: id,
        summary: `${client.name} archived — ${invoiceCount} invoice(s) retained`,
        isManualOverride: true,
        before: client,
      },
      tx
    );
    return "archived";
  });
}

export async function restoreClient(id: string): Promise<void> {
  await db.clients.update(id, { archived: false, updatedAt: nowIso() });
}

/** Case-insensitive match on name, contact, or tax ID — what you would type when hunting for a client. */
export function matchesClientSearch(client: Client, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [client.name, client.primaryContact, client.taxId, client.country]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(q));
}
