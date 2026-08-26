"use client";

import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { db } from "@/lib/db";
import type { EntityProfile, Invoice } from "@/lib/types";
import { newId } from "@/lib/ids";
import { addDays, financialYearOf, todayIsoDate } from "@/lib/fy";
import { formatMoney, formatNumber, round2 } from "@/lib/money";
import { peekNextSerial } from "@/lib/serial";
import { createInvoice, updateInvoice } from "@/lib/invoices";
import { missingProfileFields } from "@/lib/entity-profile";
import { positiveNumberField } from "@/lib/form-schema";
import { IGST_LINE_LABEL } from "@/lib/igst";

const lineItemSchema = z.object({
  id: z.string(),
  description: z.string().trim().min(1, "Describe the service."),
  quantity: positiveNumberField("Must be greater than zero."),
  unitPrice: positiveNumberField("Must be greater than zero."),
});

const schema = z
  .object({
    clientId: z.string().min(1, "Select a client."),
    currency: z.string().min(1, "Select a currency."),
    invoiceDate: z.string().min(1, "Required."),
    dueDate: z.string().min(1, "Required."),
    // The rate is frozen on save and reused by forex realization forever, so a
    // typo here quietly corrupts every gain/loss figure downstream.
    invoiceDateFxRate: positiveNumberField("Enter the rate on the invoice date."),
    notes: z.string().trim().optional(),
    lineItems: z.array(lineItemSchema).min(1, "Add at least one line item."),
  })
  .refine((values) => values.dueDate >= values.invoiceDate, {
    message: "Due date cannot be before the invoice date.",
    path: ["dueDate"],
  });

type FormValues = z.input<typeof schema>;

function blankLineItem() {
  return { id: newId(), description: "", quantity: 1, unitPrice: 0 };
}

export function InvoiceFormSheet({
  open,
  onOpenChange,
  profile,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: EntityProfile;
  /** Omit to create; pass an invoice to edit it. */
  invoice?: Invoice;
}) {
  const clients = useLiveQuery(
    () => db.clients.filter((c) => !c.archived).sortBy("name"),
    []
  );
  const currencies = useLiveQuery(
    () => db.currencies.filter((c) => c.active && !c.isBase).toArray(),
    []
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: blankValues(profile),
  });
  const lineItems = useFieldArray({ control: form.control, name: "lineItems" });

  useEffect(() => {
    if (open) form.reset(invoice ? toFormValues(invoice) : blankValues(profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice?.id]);

  const watched = form.watch();
  const currency = watched.currency || "USD";
  const totalFcy = round2(
    (watched.lineItems ?? []).reduce(
      (sum, item) => sum + (Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0),
      0
    )
  );
  const totalInr = round2(totalFcy * (Number(watched.invoiceDateFxRate) || 0));

  const serialPreview = useLiveQuery(
    () => peekNextSerial(profile, financialYearOf(watched.invoiceDate || todayIsoDate())),
    [profile.invoiceSerialPrefix, profile.invoiceSerialPadding, watched.invoiceDate]
  );

  const profileGaps = missingProfileFields(profile);

  /** Selecting a client adopts their default currency — but never overwrites a currency already chosen by hand. */
  function onClientChange(clientId: string) {
    form.setValue("clientId", clientId, { shouldDirty: true });
    const client = (clients ?? []).find((c) => c.id === clientId);
    if (client && !form.getFieldState("currency").isDirty) {
      form.setValue("currency", client.defaultCurrency);
    }
  }

  function onInvoiceDateChange(value: string) {
    form.setValue("invoiceDate", value, { shouldDirty: true });
    if (!form.getFieldState("dueDate").isDirty && value) {
      form.setValue("dueDate", addDays(value, profile.defaultPaymentTermsDays));
    }
  }

  async function save(values: FormValues, issue: boolean) {
    const parsed = schema.parse(values);
    try {
      if (invoice) {
        await updateInvoice(invoice.id, {
          ...parsed,
          status: issue && invoice.status === "draft" ? "sent" : invoice.status,
        });
        toast.success(`${invoice.serialNumber} saved.`);
      } else {
        const created = await createInvoice({ ...parsed, status: issue ? "sent" : "draft" }, profile);
        toast.success(
          issue ? `${created.serialNumber} issued.` : `${created.serialNumber} saved as draft.`
        );
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this invoice.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{invoice ? `Edit ${invoice.serialNumber}` : "New invoice"}</SheetTitle>
          <SheetDescription>
            {invoice
              ? "The serial number and financial year are fixed and cannot change."
              : serialPreview
                ? `Will be issued as ${serialPreview}`
                : "Export of services, zero-rated under LUT."}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            id="invoice-form"
            onSubmit={form.handleSubmit((values) => save(values, true))}
            className="flex-1 space-y-5 overflow-y-auto px-4"
          >
            {profileGaps.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-status-overdue/30 bg-status-overdue-bg p-3 text-sm text-status-overdue">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  A PDF cannot be generated until these are filled in under Settings:{" "}
                  <span className="font-medium">{profileGaps.join(", ")}</span>. You can still save
                  the invoice.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client</FormLabel>
                    <Select value={field.value} onValueChange={onClientChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a client" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(clients ?? []).map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.name} — {client.country}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(currencies ?? []).map((item) => (
                          <SelectItem key={item.code} value={item.code}>
                            {item.code} — {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        onChange={(e) => onInvoiceDateChange(e.target.value)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceDateFxRate"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Exchange rate on invoice date (1 {currency} → INR)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.0001" min="0" {...field} />
                    </FormControl>
                    <FormDescription>
                      Frozen on this invoice and reused to compute realized forex gain/loss when the
                      remittance arrives. It is never re-fetched, so enter the rate that actually
                      applied on the invoice date.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormLabel className="text-base">Line items</FormLabel>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => lineItems.append(blankLineItem())}
                >
                  <Plus data-icon="inline-start" />
                  Add line
                </Button>
              </div>

              {lineItems.fields.map((field, index) => (
                <div key={field.id} className="rounded-lg border p-3">
                  <FormField
                    control={form.control}
                    name={`lineItems.${index}.description`}
                    render={({ field: descField }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Description</FormLabel>
                        <FormControl>
                          <Input placeholder="Consulting services — March 2027" {...descField} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.quantity`}
                      render={({ field: qtyField }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Qty</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...qtyField} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.unitPrice`}
                      render={({ field: priceField }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Rate ({currency})</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...priceField} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid gap-2">
                      <span className="text-sm font-medium">Amount</span>
                      <span className="h-8 content-center text-sm tabular-nums">
                        {formatNumber(
                          round2(
                            (Number(watched.lineItems?.[index]?.quantity) || 0) *
                              (Number(watched.lineItems?.[index]?.unitPrice) || 0)
                          ),
                          "en-US"
                        )}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => lineItems.remove(index)}
                      disabled={lineItems.fields.length === 1}
                      aria-label={`Remove line ${index + 1}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}

              {form.formState.errors.lineItems?.root && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.lineItems.root.message}
                </p>
              )}
            </div>

            <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
              <Row label="Subtotal" value={formatMoney(totalFcy, currency)} />
              <Row label={IGST_LINE_LABEL} value={formatMoney(0, currency)} />
              <Separator className="my-2" />
              <Row label="Total due" value={formatMoney(totalFcy, currency)} strong />
              <Row label="INR equivalent (books)" value={formatMoney(totalInr, "INR")} muted />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Optional, printed on the PDF" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <SheetFooter className="flex-col gap-2 sm:flex-row">
          <Button type="submit" form="invoice-form" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            {invoice ? "Save changes" : "Save & issue"}
          </Button>
          {!invoice && (
            <Button
              type="button"
              variant="outline"
              disabled={form.formState.isSubmitting}
              onClick={form.handleSubmit((values) => save(values, false))}
            >
              Save as draft
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
      <span
        className={
          strong
            ? "font-semibold tabular-nums"
            : muted
              ? "tabular-nums text-muted-foreground"
              : "tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

function blankValues(profile: EntityProfile): FormValues {
  const today = todayIsoDate();
  return {
    clientId: "",
    currency: "USD",
    invoiceDate: today,
    dueDate: addDays(today, profile.defaultPaymentTermsDays),
    invoiceDateFxRate: "",
    notes: "",
    lineItems: [blankLineItem()],
  };
}

function toFormValues(invoice: Invoice): FormValues {
  return {
    clientId: invoice.clientId,
    currency: invoice.currency,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    invoiceDateFxRate: invoice.invoiceDateFxRate,
    notes: invoice.notes ?? "",
    lineItems: invoice.lineItems.map((item) => ({ ...item })),
  };
}
