"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Download, Loader2, Pencil, Send, Trash2, Undo2, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { StatusBadge } from "@/components/status-badge";
import { db } from "@/lib/db";
import type { EntityProfile, Invoice } from "@/lib/types";
import {
  deriveInvoiceStatus,
  deleteInvoice,
  isFullyCovered,
  outstandingFcy,
  receivedFcy,
  setInvoiceStatus,
} from "@/lib/invoices";
import { formatFxRate, formatMoney, invoiceTotalFcy, invoiceTotalInr, lineItemAmount } from "@/lib/money";
import { formatFinancialYear, parseIsoDate } from "@/lib/fy";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { IGST_EXPORT_DISCLAIMER, IGST_LINE_LABEL } from "@/lib/igst";

export function InvoiceDetailSheet({
  invoice,
  profile,
  onOpenChange,
  onEdit,
}: {
  invoice: Invoice | null;
  profile: EntityProfile;
  onOpenChange: (open: boolean) => void;
  onEdit: (invoice: Invoice) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);

  const remittances = useLiveQuery(
    () => (invoice ? db.remittances.where("invoiceId").equals(invoice.id).toArray() : []),
    [invoice?.id],
    []
  );

  if (!invoice) return null;

  const status = deriveInvoiceStatus(invoice, remittances);
  const totalFcy = invoiceTotalFcy(invoice);
  const received = receivedFcy(remittances);
  const outstanding = outstandingFcy(invoice, remittances);
  const covered = isFullyCovered(invoice, remittances);

  async function onDownload() {
    setDownloading(true);
    try {
      await downloadInvoicePdf(invoice!, profile);
      toast.success("PDF downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the PDF.");
    } finally {
      setDownloading(false);
    }
  }

  async function changeStatus(next: "draft" | "sent" | "paid", isManualOverride = false) {
    try {
      await setInvoiceStatus(invoice!.id, next, { isManualOverride });
      toast.success(`${invoice!.serialNumber} marked ${next}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the status.");
    }
  }

  /** Marking Paid with no covering remittance is a manual override and is flagged as one in the audit trail. */
  function onMarkPaid() {
    if (covered) {
      changeStatus("paid");
    } else {
      setConfirmOverride(true);
    }
  }

  async function onDelete() {
    try {
      await deleteInvoice(invoice!.id);
      toast.success(`${invoice!.serialNumber} deleted. The serial is not reused.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete this invoice.");
    } finally {
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <SheetTitle className="font-mono">{invoice.serialNumber}</SheetTitle>
              <StatusBadge status={status} />
              {invoice.manualStatusOverride && <Badge variant="outline">Manual override</Badge>}
            </div>
            <SheetDescription>
              {invoice.clientSnapshot.name} · {formatFinancialYear(invoice.financialYear)}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Invoice date" value={formatDate(invoice.invoiceDate)} />
              <Field label="Due date" value={formatDate(invoice.dueDate)} />
              <Field label="Currency" value={invoice.currency} />
              <Field
                label="Invoice-date FX rate"
                value={`1 ${invoice.currency} = INR ${formatFxRate(invoice.invoiceDateFxRate)}`}
              />
            </div>

            <Separator />

            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">Line items</h3>
              <div className="space-y-2">
                {invoice.lineItems.map((item) => (
                  <div key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{item.description}</p>
                      <p className="text-muted-foreground">
                        {item.quantity} × {formatMoney(item.unitPrice, invoice.currency)}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums">
                      {formatMoney(lineItemAmount(item), invoice.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
              <Row label="Subtotal" value={formatMoney(totalFcy, invoice.currency)} />
              <Row label={IGST_LINE_LABEL} value={formatMoney(0, invoice.currency)} />
              <Separator className="my-2" />
              <Row label="Total due" value={formatMoney(totalFcy, invoice.currency)} strong />
              <Row
                label="INR equivalent (books)"
                value={formatMoney(invoiceTotalInr(invoice), "INR")}
                muted
              />
            </div>

            {remittances.length > 0 && (
              <div className="space-y-1 rounded-lg border p-3 text-sm">
                <Row label="Received" value={formatMoney(received, invoice.currency)} />
                <Row
                  label="Outstanding"
                  value={formatMoney(Math.max(0, outstanding), invoice.currency)}
                  strong
                />
                <p className="pt-1 text-muted-foreground">
                  {remittances.length} remittance{remittances.length === 1 ? "" : "s"} recorded
                </p>
              </div>
            )}

            {invoice.notes && (
              <div>
                <h3 className="mb-1 text-sm font-medium text-muted-foreground">Notes</h3>
                <p className="text-sm whitespace-pre-line">{invoice.notes}</p>
              </div>
            )}

            <div className="rounded-lg border border-[color:var(--chart-2)]/30 bg-secondary/50 p-3">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-[color:var(--chart-2)]">
                DECLARATION ON PDF
              </h3>
              <p className="text-xs leading-relaxed">{IGST_EXPORT_DISCLAIMER}</p>
            </div>
          </div>

          <SheetFooter>
            <div className="grid w-full grid-cols-2 gap-2">
              <Button onClick={onDownload} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                Download PDF
              </Button>
              <Button variant="outline" onClick={() => onEdit(invoice)}>
                <Pencil data-icon="inline-start" />
                Edit
              </Button>

              {invoice.status === "draft" && (
                <Button variant="outline" onClick={() => changeStatus("sent")}>
                  <Send data-icon="inline-start" />
                  Mark sent
                </Button>
              )}
              {invoice.status === "sent" && (
                <Button variant="outline" onClick={onMarkPaid}>
                  <Wallet data-icon="inline-start" />
                  Mark paid
                </Button>
              )}
              {invoice.status === "paid" && (
                <Button variant="outline" onClick={() => changeStatus("sent")}>
                  <Undo2 data-icon="inline-start" />
                  Reopen
                </Button>
              )}

              <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 data-icon="inline-start" />
                Delete
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOverride} onOpenChange={setConfirmOverride}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark paid without a remittance?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatMoney(Math.max(0, outstanding), invoice.currency)} of this invoice is still
              outstanding, so no remittance covers it. Marking it paid anyway is recorded in the
              audit trail as a manual override, and no realized forex gain or loss is computed —
              that only happens when you log the actual remittance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOverride(false);
                changeStatus("paid", true);
              }}
            >
              Mark paid anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {invoice.serialNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its ledger postings are reversed and the deletion is logged. The serial number is
              <strong> not </strong>
              reused — the series will show a documented gap, which is the correct outcome for a
              compliance trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete invoice</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={muted ? "text-muted-foreground" : undefined}>{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  );
}

function formatDate(isoDate: string): string {
  return parseIsoDate(isoDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
