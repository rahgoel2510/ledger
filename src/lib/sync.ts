import type { Transaction } from "dexie";
import { collection, deleteDoc, doc, onSnapshot, setDoc, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/db";
import { firebaseConfigured, firestore } from "@/lib/firebase";
import { SYNCED_TABLES, type ClientDocument, type Counter, type SyncedTable, type SyncQueueEntry } from "@/lib/types";
import { reconcileCounters } from "@/lib/serial";

/**
 * Multi-device sync (Dexie stays primary; Firestore is a sync layer on top,
 * not a replacement — see CLAUDE.md "Local persistence"). Outbox pattern:
 * every mutating domain function calls `enqueueSync` right after its Dexie
 * write, inside the same transaction; a drain loop pushes queued rows to
 * Firestore; per-table `onSnapshot` listeners pull remote changes back into
 * Dexie. Sign-in is optional — nothing here runs unless `startSyncEngine` has
 * been called, which only happens once a user is signed in.
 */

/** Fields never pushed to Firestore. `clientDocuments.file` is a Blob — Firestore has no such type and a 1MiB doc cap besides. */
const FIELD_STRIP: Partial<Record<SyncedTable, string[]>> = {
  clientDocuments: ["file"],
};

function stripFields<T extends Record<string, unknown>>(row: T, fields: string[] | undefined): T {
  if (!fields || fields.length === 0) return row;
  const copy = { ...row };
  for (const field of fields) delete copy[field];
  return copy;
}

/**
 * Queues `(table, docId)` for push. Idempotent by design: the queue entry's
 * primary key is `${table}:${docId}`, so re-enqueueing the same row before it
 * drains just refreshes `queuedAt` rather than piling up duplicates, and the
 * drain worker reads the *current* Dexie row at push time rather than
 * whatever was passed here — so this never carries a stale payload.
 */
export async function enqueueSync(
  tx: Transaction | null,
  table: SyncedTable,
  docId: string
): Promise<void> {
  const entry: SyncQueueEntry = { id: `${table}:${docId}`, table, docId, queuedAt: new Date().toISOString() };
  const queue = tx ? tx.table<SyncQueueEntry>("syncQueue") : db.syncQueue;
  await queue.put(entry);
  kick?.();
}

/** Set while `startSyncEngine` is active; lets `enqueueSync` opportunistically trigger a drain without every call site knowing the signed-in uid. */
let kick: (() => void) | null = null;

async function pushOne(uid: string, table: SyncedTable, docId: string): Promise<void> {
  if (!firestore) return;
  const row = await db.table(table).get(docId);
  const ref = doc(firestore, "users", uid, table, docId);
  if (row === undefined) {
    await deleteDoc(ref);
    return;
  }
  await setDoc(ref, stripFields(row as Record<string, unknown>, FIELD_STRIP[table]));
}

let draining = false;

async function drainOutbox(uid: string): Promise<void> {
  if (!firebaseConfigured || draining) return;
  draining = true;
  try {
    while (true) {
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
      const next = await db.syncQueue.orderBy("queuedAt").first();
      if (!next) break;
      await pushOne(uid, next.table, next.docId);
      await db.syncQueue.delete(next.id);
    }
  } catch (error) {
    // Left in the queue for the next trigger (reconnect, next enqueue, next sign-in).
    console.error("Sync push failed, will retry", error);
  } finally {
    draining = false;
  }
}

/**
 * Applies one remote change into Dexie. `counters` merges as
 * max(local, remote) rather than overwriting — it's a monotonic invoice
 * sequence, not a document that's safe to resolve last-write-wins (see
 * CLAUDE.md on the accepted duplicate-serial risk).
 *
 * `clientDocuments` only merges onto a row that already exists locally,
 * preserving its `file` Blob — a brand-new document synced from another
 * device has no local bytes to store yet (that's the GCS phase), so it's left
 * out of the local table entirely rather than written with a fake empty file.
 */
async function applyRemoteChange(
  table: SyncedTable,
  changeType: "added" | "modified" | "removed",
  docId: string,
  data: DocumentData
): Promise<void> {
  const target = db.table(table);

  if (changeType === "removed") {
    await target.delete(docId);
    return;
  }

  if (table === "counters") {
    const local = await db.counters.get(docId);
    const remote = data as Counter;
    if (!local || remote.value > local.value) await target.put(remote);
    return;
  }

  if (table === "clientDocuments") {
    const local = await db.clientDocuments.get(docId);
    if (!local) return; // no local file bytes to complete the row with yet
    await target.put({ ...local, ...data, file: local.file } satisfies ClientDocument);
    return;
  }

  await target.put(data);
}

/** Starts pull listeners + the push drain loop for a signed-in user. Returns a stop function. */
export function startSyncEngine(uid: string): () => void {
  if (!firebaseConfigured || !firestore) return () => {};
  const fs = firestore;

  const unsubscribes: (() => void)[] = [];

  for (const table of SYNCED_TABLES) {
    const ref = collection(fs, "users", uid, table);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      let touchedInvoices = false;
      for (const change of snapshot.docChanges()) {
        // A pending write is an echo of our own not-yet-acknowledged push —
        // Dexie already holds this exact data, so applying it again is a no-op
        // at best and a race with a newer local edit at worst.
        if (change.doc.metadata.hasPendingWrites) continue;
        void applyRemoteChange(table, change.type, change.doc.id, change.doc.data());
        if (table === "invoices") touchedInvoices = true;
      }
      // Raises the local counter to at least the highest synced sequence, so
      // an invoice created next on this device doesn't reuse a number a
      // just-pulled invoice from another device already claimed.
      if (touchedInvoices) void reconcileCounters();
    });
    unsubscribes.push(unsubscribe);
  }

  kick = () => void drainOutbox(uid);
  kick();
  const onOnline = () => kick?.();
  window.addEventListener("online", onOnline);

  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    window.removeEventListener("online", onOnline);
    kick = null;
  };
}
