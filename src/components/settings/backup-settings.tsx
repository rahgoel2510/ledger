"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  backupFileName,
  downloadJson,
  exportBackup,
  importBackup,
  parseBackup,
  type BackupFile,
} from "@/lib/backup";

/**
 * Local backup/restore. IndexedDB is the source of truth and lives in exactly
 * one browser profile — this JSON file is the only thing standing between
 * "cleared site data" and losing the books, so it is deliberately dependency-free.
 */
export function BackupSettings() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);

  async function onExport() {
    setBusy("export");
    try {
      const backup = await exportBackup();
      downloadJson(backupFileName(backup.exportedAt), backup);
      toast.success("Backup downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onFilePicked(file: File | undefined) {
    if (!file) return;
    try {
      setPending(parseBackup(await file.text()));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
    } finally {
      // Allow re-picking the same file after a failed or cancelled attempt.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function confirmImport() {
    if (!pending) return;
    setBusy("import");
    try {
      const summary = await importBackup(pending);
      toast.success(
        `Restored ${summary.invoices ?? 0} invoice(s), ${summary.clients ?? 0} client(s) and ${summary.ledgerEntries ?? 0} ledger entries.`
      );
      setPending(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Local backup</CardTitle>
          <CardDescription>
            All your data lives in this browser on this device. Export regularly — clearing site
            data, reinstalling the browser, or losing the device takes the books with it. The file
            contains everything: invoices, clients, remittances, ledger, and audit trail.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" onClick={onExport} disabled={busy !== null}>
            {busy === "export" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download data-icon="inline-start" />
            )}
            Export backup
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
          >
            <Upload data-icon="inline-start" />
            Restore from backup
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onFilePicked(e.target.files?.[0])}
          />
        </CardContent>
      </Card>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace all local data?</AlertDialogTitle>
            <AlertDialogDescription>
              This backup was taken on {pending?.exportedAt.slice(0, 10)} and contains{" "}
              {pending?.data.invoices?.length ?? 0} invoice(s) and{" "}
              {pending?.data.clients?.length ?? 0} client(s). Restoring replaces everything
              currently on this device — it is not a merge. Export a backup of the current data
              first if you might need it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "import"}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport} disabled={busy === "import"}>
              {busy === "import" ? "Restoring…" : "Replace all data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
