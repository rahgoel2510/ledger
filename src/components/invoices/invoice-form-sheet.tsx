"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { ListTree, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import type { Client, EntityProfile, Invoice } from "@/lib/types";
import { newId } from "@/lib/ids";
import { addDays, financialYearOf, todayIsoDate } from "@/lib/fy";
import { formatMoney, formatNumber, gstHalves, round2, taskHours } from "@/lib/money";
import { peekNextSerial } from "@/lib/serial";
import { createInvoice, updateInvoice, DEFAULT_DOMESTIC_GST_RATE } from "@/lib/invoices";
import { unconfirmedProfileFields } from "@/lib/entity-profile";
import { optionalNumberField, positiveNumberField } from "@/lib/form-schema";
import { IGST_LINE_LABEL } from "@/lib/igst";
import { BASE_CURRENCY_CODE } from "@/lib/currencies";

/**
 * One row of the annexure. Hours but no rate — the rate belongs to the line the
 * task sits under, so a task can never quietly reprice the work.
 */
const taskSchema = z.object({
  id: z.string(),
  date: z.string().min(1, "Required — every task is dated."),
  description: z.string().trim().min(1, "Describe the task."),
  hours: positiveNumberField("Must be greater than zero."),
});

const lineItemSchema = z.object({
  id: z.string(),
  date: z.string().optional(),
  description: z.string().trim().min(1, "Describe the service."),
  quantity: positiveNumberField("Must be greater than zero."),
  unitPrice: positiveNumberField("Must be greater than zero."),
  unit: z.enum(["hours", "flat"]),
  tasks: z.array(taskSchema),
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
    billingModel: z.enum(["hourly", "fixed"]),
    lineItems: z.array(lineItemSchema).min(1, "Add at least one line item."),

    // Domestic only. Blank on an export invoice, where `taxFaceOf` forces 0%.
    gstRate: optionalNumberField("Enter a percentage between 0 and 100."),
    taxTreatment: z.enum(["zero_rated_export", "igst", "cgst_sgst"]).optional(),
    sacCode: z.string().trim().optional(),
    poNumber: z.string().trim().optional(),
    reverseCharge: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.dueDate < values.invoiceDate) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot be before the invoice date.",
      });
    }
    if (values.gstRate !== undefined && values.gstRate > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["gstRate"],
        message: "Enter a percentage between 0 and 100.",
      });
    }
    // Hourly work is billed date-wise, and the date is what makes the line
    // defensible — an unlabelled block of hours is not a record of consultation.
    // A line broken into tasks satisfies that through the tasks' own dates, so
    // it is the one case where the line itself carries none.
    values.lineItems.forEach((item, index) => {
      if (item.unit === "hours" && item.tasks.length === 0 && !item.date) {
        ctx.addIssue({
          code: "custom",
          path: ["lineItems", index, "date"],
          message: "Required — hourly lines are itemised by date.",
        });
      }
    });
  });

type FormValues = z.input<typeof schema>;
type ParsedValues = z.output<typeof schema>;

function blankLineItem(unit: "hours" | "flat", date?: string, unitPrice?: number) {
  return {
    id: newId(),
    date: unit === "hours" ? (date ?? todayIsoDate()) : "",
    description: "",
    quantity: unit === "hours" ? "" : 1,
    unitPrice: unitPrice === undefined ? "" : String(unitPrice),
    unit,
    tasks: [] as FormValues["lineItems"][number]["tasks"],
  };
}

function blankTask(date?: string) {
  return { id: newId(), date: date ?? todayIsoDate(), description: "", hours: "" };
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
  const clients = useLiveQuery(() => db.clients.filter((c) => !c.archived).sortBy("name"), []);
  const allCurrencies = useLiveQuery(() => db.currencies.filter((c) => c.active).toArray(), []);

  const form = useForm<FormValues, unknown, ParsedValues>({
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
  const isBaseCurrency = currency === BASE_CURRENCY_CODE;
  const billingModel = watched.billingModel ?? "hourly";

  // An invoice already in rupees has no rate to capture -- one rupee is one
  // rupee -- but the ledger still multiplies by this figure, so it is filled
  // rather than left blank and the field is hidden rather than asked. The 1 is
  // cleared on the way back out: no foreign currency is ever one to the rupee,
  // so carrying it over would post a wrong INR figure without saying so.
  useEffect(() => {
    const rate = form.getValues("invoiceDateFxRate");
    if (isBaseCurrency && rate !== "1") form.setValue("invoiceDateFxRate", "1");
    if (!isBaseCurrency && rate === "1") form.setValue("invoiceDateFxRate", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBaseCurrency]);

  const client = (clients ?? []).find((c) => c.id === watched.clientId);
  // While editing, the invoice's own snapshot is what it was raised under — the
  // live client row may since have been reclassified, and that must not silently
  // change what an issued invoice says about the supply.
  const isDomestic = invoice
    ? invoice.placeOfSupply === "domestic"
    : client?.placeOfSupply === "domestic";

  // The base currency is only offered on a domestic supply: an export invoice
  // billed in INR has no foreign currency to realize a gain against.
  const currencies = (allCurrencies ?? []).filter((item) => isDomestic || !item.isBase);

  const subtotalFcy = round2(
    (watched.lineItems ?? []).reduce(
      (sum, item) => sum + (Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0),
      0
    )
  );
  const gstRate = isDomestic ? Number(watched.gstRate) || 0 : 0;
  const taxFcy = round2((subtotalFcy * gstRate) / 100);
  const totalFcy = round2(subtotalFcy + taxFcy);
  const totalInr = round2(totalFcy * (Number(watched.invoiceDateFxRate) || 0));
  const split = gstHalves(taxFcy);

  const serialPreview = useLiveQuery(
    () => peekNextSerial(profile, financialYearOf(watched.invoiceDate || todayIsoDate())),
    [profile.invoiceSerialPrefix, profile.invoiceSerialPadding, watched.invoiceDate]
  );

  const profileGaps = unconfirmedProfileFields(profile);
  const totalHours = round2(
    (watched.lineItems ?? [])
      .filter((item) => item?.unit === "hours")
      .reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0)
  );

  /** Selecting a client adopts their defaults — but never overwrites a value chosen by hand. */
  function onClientChange(clientId: string) {
    form.setValue("clientId", clientId, { shouldDirty: true });
    const picked = (clients ?? []).find((c) => c.id === clientId);
    if (!picked) return;

    if (!form.getFieldState("currency").isDirty) {
      form.setValue("currency", picked.defaultCurrency);
    }
    if (!form.getFieldState("billingModel").isDirty) {
      applyBillingModel(picked.billing.model, picked);
    }
    if (picked.placeOfSupply === "domestic") {
      if (!form.getFieldState("gstRate").isDirty) {
        form.setValue("gstRate", String(picked.defaultGstRate ?? DEFAULT_DOMESTIC_GST_RATE));
      }
      if (!form.getFieldState("taxTreatment").isDirty) {
        form.setValue("taxTreatment", picked.defaultTaxTreatment ?? "igst");
      }
      if (!form.getFieldState("sacCode").isDirty && picked.defaultSacCode) {
        form.setValue("sacCode", picked.defaultSacCode);
      }
    }
  }

  /** Switching how the work is billed re-labels every existing line, so the unit on the record matches what the columns say. */
  function applyBillingModel(next: "hourly" | "fixed", forClient?: Client) {
    form.setValue("billingModel", next, { shouldDirty: true });
    const rate = forClient?.billing.hourlyRate ?? client?.billing.hourlyRate;

    (form.getValues("lineItems") ?? []).forEach((item, index) => {
      form.setValue(`lineItems.${index}.unit`, next === "hourly" ? "hours" : "flat");
      if (next === "hourly") {
        if (!item.date && (item.tasks?.length ?? 0) === 0) {
          form.setValue(`lineItems.${index}.date`, todayIsoDate());
        }
        if (!item.unitPrice && rate !== undefined) {
          form.setValue(`lineItems.${index}.unitPrice`, String(rate));
        }
      } else {
        // A flat retainer line is a period, not time worked — there are no hours
        // under it to itemise, so any breakdown is dropped with the unit change.
        form.setValue(`lineItems.${index}.tasks`, []);
        // Hours are always typed; a count of periods defaults to one, the same
        // way a line created in this mode does.
        if (item.quantity === "" || item.quantity === undefined) {
          form.setValue(`lineItems.${index}.quantity`, 1);
        }
      }
    });
  }

  function addLine() {
    const existing = form.getValues("lineItems") ?? [];
    const lastDate = [...existing].reverse().find((item) => item.date)?.date;
    lineItems.append(
      blankLineItem(
        billingModel === "hourly" ? "hours" : "flat",
        lastDate ? String(lastDate) : undefined,
        client?.billing.hourlyRate
      )
    );
  }

  function onInvoiceDateChange(value: string) {
    form.setValue("invoiceDate", value, { shouldDirty: true });
    if (!form.getFieldState("dueDate").isDirty && value) {
      form.setValue("dueDate", addDays(value, profile.defaultPaymentTermsDays));
    }
  }

  async function save(values: ParsedValues, issue: boolean) {
    const patch = {
      clientId: values.clientId,
      currency: values.currency,
      invoiceDate: values.invoiceDate,
      dueDate: values.dueDate,
      invoiceDateFxRate: values.invoiceDateFxRate,
      notes: values.notes,
      poNumber: values.poNumber || undefined,
      reverseCharge: values.reverseCharge,
      sacCode: values.sacCode || undefined,
      billingModel: values.billingModel,
      lineItems: values.lineItems.map((item) => {
        const tasks = item.tasks.map((task) => ({
          id: task.id,
          date: task.date,
          description: task.description,
          hours: task.hours,
        }));
        return {
          id: item.id,
          // A line with a breakdown carries no date of its own: the tasks' dates
          // are the record, and the annexure is where they are printed.
          date: item.unit === "hours" && tasks.length === 0 ? item.date : undefined,
          description: item.description,
          // Billed on the breakdown when there is one, so the figure on the
          // invoice face can never contradict the rows in the annexure.
          quantity: tasks.length > 0 ? taskHours(tasks) : item.quantity,
          unitPrice: item.unitPrice,
          unit: item.unit,
          ...(tasks.length > 0 ? { tasks } : {}),
        };
      }),
      // Left out entirely on an export invoice: `taxFaceOf` forces zero-rating
      // there, and sending a rate would only invite it to be honoured one day.
      ...(isDomestic
        ? {
            gstRate: values.gstRate ?? DEFAULT_DOMESTIC_GST_RATE,
            taxTreatment: values.taxTreatment ?? "igst",
          }
        : {}),
    };

    try {
      if (invoice) {
        await updateInvoice(invoice.id, {
          ...patch,
          status: issue && invoice.status === "draft" ? "sent" : invoice.status,
        });
        toast.success(`${invoice.serialNumber} saved.`);
      } else {
        const created = await createInvoice({ ...patch, status: issue ? "sent" : "draft" }, profile);
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
              <div className="text-muted-foreground flex gap-2 rounded-lg border p-3 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  This invoice will print with{" "}
                  <span className="text-foreground font-medium">{profileGaps.join(", ")}</span>{" "}
                  unconfirmed — fill them in under Settings before sending it to a client.
                </p>
              </div>
            )}

            {invoice?.autoGenerated && invoice.periodStart && (
              <div className="text-muted-foreground rounded-lg border p-3 text-sm">
                Drafted automatically for the retainer period {invoice.periodStart} to{" "}
                {invoice.periodEnd}. It has already taken serial{" "}
                <span className="font-medium">{invoice.serialNumber}</span> — deleting it leaves a
                permanent gap in the series.
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
                        {(clients ?? []).map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} — {item.country}
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
                        {currencies.map((item) => (
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

              {isBaseCurrency ? null : (
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
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FormLabel className="text-base">Line items</FormLabel>
                  {billingModel === "hourly" && totalHours > 0 && (
                    <Badge variant="secondary">{formatNumber(totalHours, "en-US")} hrs</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={billingModel}
                    onValueChange={(value) => applyBillingModel(value as "hourly" | "fixed")}
                  >
                    <SelectTrigger size="sm" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Itemised by date</SelectItem>
                      <SelectItem value="fixed">Fixed amounts</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="outline" onClick={addLine}>
                    <Plus data-icon="inline-start" />
                    Add line
                  </Button>
                </div>
              </div>

              {billingModel === "hourly" && (
                <p className="text-muted-foreground text-xs">
                  One line per consultation: the date it happened, what was done, the hours, and the
                  rate per hour. The PDF prints them in this order.
                </p>
              )}

              {lineItems.fields.map((field, index) => {
                // A line with a breakdown is billed on its tasks: it shows their
                // summed hours read-only and drops its own date, because the
                // dates that matter are the tasks'.
                const itemised = (watched.lineItems?.[index]?.tasks?.length ?? 0) > 0;
                const itemisedHours = round2(
                  (watched.lineItems?.[index]?.tasks ?? []).reduce(
                    (sum, task) => sum + (Number(task?.hours) || 0),
                    0
                  )
                );

                return (
                <div key={field.id} className="rounded-lg border p-3">
                  <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
                    {billingModel === "hourly" && !itemised && (
                      <FormField
                        control={form.control}
                        name={`lineItems.${index}.date`}
                        render={({ field: dateField }) => (
                          <FormItem className="sm:w-40">
                            <FormLabel className="text-sm">Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...dateField} value={dateField.value ?? ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.description`}
                      render={({ field: descField }) => (
                        <FormItem
                          className={
                            billingModel === "hourly" && !itemised ? "" : "sm:col-span-2"
                          }
                        >
                          <FormLabel className="text-sm">
                            {billingModel === "hourly" ? "Consultation" : "Description"}
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={
                                billingModel === "hourly"
                                  ? "Architecture review call"
                                  : "Consulting services — March 2027"
                              }
                              {...descField}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.quantity`}
                      render={({ field: qtyField }) => (
                        <FormItem>
                          <FormLabel className="text-sm">
                            {billingModel === "hourly" ? "Hours" : "Qty"}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.25"
                              min="0"
                              {...qtyField}
                              readOnly={itemised}
                              aria-readonly={itemised || undefined}
                              className={itemised ? "bg-muted text-muted-foreground" : undefined}
                            />
                          </FormControl>
                          {itemised && (
                            <FormDescription>Summed from the task breakdown.</FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.unitPrice`}
                      render={({ field: priceField }) => (
                        <FormItem>
                          <FormLabel className="text-sm">
                            {billingModel === "hourly" ? `Rate/hour (${currency})` : `Rate (${currency})`}
                          </FormLabel>
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
                            (itemised
                              ? itemisedHours
                              : Number(watched.lineItems?.[index]?.quantity) || 0) *
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

                  {billingModel === "hourly" && (
                    <LineItemTasks form={form} index={index} hours={itemisedHours} />
                  )}
                </div>
                );
              })}

              {form.formState.errors.lineItems?.root && (
                <p className="text-destructive text-sm">
                  {form.formState.errors.lineItems.root.message}
                </p>
              )}
            </div>

            {isDomestic && (
              <>
                <Separator />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="taxTreatment"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tax treatment</FormLabel>
                        <Select value={field.value ?? "igst"} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="igst">IGST</SelectItem>
                            <SelectItem value="cgst_sgst">CGST + SGST</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="gstRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>GST rate (%)</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="decimal"
                            placeholder={String(DEFAULT_DOMESTIC_GST_RATE)}
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  The rate printed is the one you enter here. The app records it; it does not work
                  out what is owed.
                </p>
              </>
            )}

            <Separator />

            {/*
              Particulars the invoice has to carry whichever way the supply is
              classified. The SAC belongs here rather than in the domestic block
              above: Rule 46(g) asks for the accounting code of the service on an
              export too. Reverse charge is a domestic question only — an export
              of services under LUT is never on that footing.
            */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="sacCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SAC code</FormLabel>
                    <FormControl>
                      <Input placeholder="998313" {...field} />
                    </FormControl>
                    <FormDescription>
                      Accounting code for the service — Rule 46(g), on exports as well.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="poNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PO / reference number</FormLabel>
                    <FormControl>
                      <Input placeholder="Client purchase order" {...field} />
                    </FormControl>
                    <FormDescription>
                      Printed on the face of the invoice. A US payables desk generally cannot pay
                      an invoice it has no PO to match.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {isDomestic && (
              <FormField
                control={form.control}
                name="reverseCharge"
                render={({ field }) => (
                  <FormItem className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <FormLabel>Tax payable on reverse charge</FormLabel>
                        <FormDescription>
                          Rule 46(p) — the invoice states this either way. Leave off unless this
                          supply is one the recipient pays the tax on.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="bg-muted space-y-1 rounded-lg p-3 text-sm">
              <Row label="Subtotal" value={formatMoney(subtotalFcy, currency)} />
              {!isDomestic && <Row label={IGST_LINE_LABEL} value={formatMoney(0, currency)} />}
              {isDomestic && watched.taxTreatment === "cgst_sgst" ? (
                <>
                  <Row
                    label={`CGST @ ${gstRate / 2}%`}
                    value={formatMoney(split.half, currency)}
                  />
                  <Row
                    label={`SGST @ ${gstRate / 2}%`}
                    value={formatMoney(split.rest, currency)}
                  />
                </>
              ) : (
                isDomestic && (
                  <Row label={`IGST @ ${gstRate}%`} value={formatMoney(taxFcy, currency)} />
                )
              )}
              <Separator className="my-2" />
              <Row label="Total due" value={formatMoney(totalFcy, currency)} strong />
              {isBaseCurrency ? null : (
                <Row label="INR equivalent (books)" value={formatMoney(totalInr, "INR")} muted />
              )}
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

/**
 * The annexure editor for one billed line.
 *
 * It lives in its own component because `useFieldArray` cannot be called inside
 * the parent's `.map()`, and because it owns one invariant: the line's Hours
 * follow the tasks beneath it. `lineItemQuantity` bills an itemised line on its
 * tasks, so a stored total that disagreed with the rows the annexure prints
 * would be an arithmetic error visible on the client's own copy.
 */
function LineItemTasks({
  form,
  index,
  hours,
}: {
  form: UseFormReturn<FormValues, unknown, ParsedValues>;
  index: number;
  /** Summed task hours, computed by the parent from the same watched values. */
  hours: number;
}) {
  const tasks = useFieldArray({ control: form.control, name: `lineItems.${index}.tasks` });
  const count = tasks.fields.length;

  useEffect(() => {
    if (count === 0) return;
    form.setValue(`lineItems.${index}.quantity`, String(hours), { shouldDirty: true });
    // The line gives up its own date once it covers several: a single date on a
    // breakdown spanning a fortnight would name one of those days arbitrarily.
    if (form.getValues(`lineItems.${index}.date`)) {
      form.setValue(`lineItems.${index}.date`, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, count, index]);

  function addTask() {
    const existing = form.getValues(`lineItems.${index}.tasks`) ?? [];
    // Tasks are usually logged in a batch days after the fact, so the last date
    // typed is a better guess than today.
    const lastDate = [...existing].reverse().find((task) => task?.date)?.date;
    tasks.append(blankTask(lastDate ? String(lastDate) : undefined));
  }

  function removeTask(taskIndex: number) {
    tasks.remove(taskIndex);
    if (count <= 1) {
      // Back to a plain hourly line. The total the breakdown left behind is no
      // longer anyone's figure, and the line needs a date of its own again.
      form.setValue(`lineItems.${index}.quantity`, "");
      form.setValue(`lineItems.${index}.date`, todayIsoDate());
    }
  }

  return (
    <div className="bg-muted/40 mt-3 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListTree className="text-muted-foreground size-4" />
          <span className="text-sm font-medium">Task breakdown</span>
          {count > 0 && (
            <Badge variant="secondary">
              {formatNumber(hours, "en-US")} hrs · Annexure A
            </Badge>
          )}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={addTask}>
          <Plus data-icon="inline-start" />
          Add task
        </Button>
      </div>

      {count === 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Optional. Add tasks and this line bills as a single figure on the invoice,
          with every task, its date and its hours printed in Annexure A.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {tasks.fields.map((taskField, taskIndex) => (
            <div
              key={taskField.id}
              className="grid gap-2 sm:grid-cols-[9.5rem_1fr_5.5rem_auto] sm:items-end"
            >
              <FormField
                control={form.control}
                name={`lineItems.${index}.tasks.${taskIndex}.date`}
                render={({ field }) => (
                  <FormItem>
                    {/* Labelled on every row so each input is reachable by name,
                        but only the first row shows the text. */}
                    <FormLabel className={taskIndex === 0 ? "text-xs" : "sr-only"}>
                      Task date
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`lineItems.${index}.tasks.${taskIndex}.description`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={taskIndex === 0 ? "text-xs" : "sr-only"}>
                      Task
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Vendor API integration review" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`lineItems.${index}.tasks.${taskIndex}.hours`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={taskIndex === 0 ? "text-xs" : "sr-only"}>
                      Task hours
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="0.25" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => removeTask(taskIndex)}
                aria-label={`Remove task ${taskIndex + 1} from line ${index + 1}`}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
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
      <span
        className={
          strong
            ? "font-semibold tabular-nums"
            : muted
              ? "text-muted-foreground tabular-nums"
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
    billingModel: "hourly",
    lineItems: [blankLineItem("hours")],
    gstRate: "",
    taxTreatment: "igst",
    sacCode: "",
    poNumber: "",
    reverseCharge: false,
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
    billingModel: invoice.billingModel,
    lineItems: invoice.lineItems.map((item) => ({
      id: item.id,
      date: item.date ?? "",
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unit: item.unit,
      tasks: (item.tasks ?? []).map((task) => ({
        id: task.id,
        date: task.date,
        description: task.description,
        hours: task.hours,
      })),
    })),
    gstRate: invoice.gstRate ? String(invoice.gstRate) : "",
    taxTreatment: invoice.taxTreatment,
    sacCode: invoice.sacCode ?? "",
    poNumber: invoice.poNumber ?? "",
    reverseCharge: invoice.reverseCharge ?? false,
  };
}
