"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { BillingCycle, Client, ContractAnalysis } from "@/lib/types";
import { createClient, updateClient, type ClientInput } from "@/lib/clients";
import { attachClientDocument, deleteClientDocument } from "@/lib/client-documents";
import { CYCLE_PRESETS, DEFAULT_CYCLE, describeCycle, presetIdFor } from "@/lib/recurring";
import { DEFAULT_DOMESTIC_GST_RATE } from "@/lib/invoices";
import { optionalNumberField } from "@/lib/form-schema";
import { ContractUploadPanel, type StagedDocument } from "./contract-upload-panel";

const schema = z
  .object({
    name: z.string().trim().min(1, "Required."),
    country: z.string().trim().min(1, "Required — drives the export-of-services treatment."),
    placeOfSupply: z.enum(["export", "domestic"]),
    defaultCurrency: z.string().trim().min(1, "Required."),
    taxId: z.string().trim().optional(),
    primaryContact: z.string().trim().optional(),
    billingAddress: z.string().trim().optional(),
    deliveryAddress: z.string().trim().optional(),

    gstin: z.string().trim().optional(),
    state: z.string().trim().optional(),
    defaultGstRate: optionalNumberField("Enter a percentage between 0 and 100."),
    defaultTaxTreatment: z.enum(["zero_rated_export", "igst", "cgst_sgst"]),
    defaultSacCode: z.string().trim().optional(),

    billingModel: z.enum(["hourly", "fixed"]),
    hourlyRate: optionalNumberField("Enter a rate, or leave blank."),
    fixedAmount: optionalNumberField("Enter an amount, or leave blank."),
    cyclePreset: z.string(),
    intervalUnit: z.enum(["week", "month"]),
    intervalCount: optionalNumberField("Enter a whole number of periods.", 1),
    cycleAnchorDate: z.string().optional(),
    autoDraft: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.defaultGstRate !== undefined && values.defaultGstRate > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultGstRate"],
        message: "Enter a percentage between 0 and 100.",
      });
    }
    // Auto-drafting counts periods forward from the anchor, so without one there
    // is nothing to count from and drafts would silently never appear.
    if (values.billingModel === "fixed" && values.autoDraft && !values.cycleAnchorDate) {
      ctx.addIssue({
        code: "custom",
        path: ["cycleAnchorDate"],
        message: "Required to draft automatically — periods are counted from this date.",
      });
    }
  });

type FormValues = z.input<typeof schema>;
type ParsedValues = z.output<typeof schema>;

const BLANK: FormValues = {
  name: "",
  country: "",
  placeOfSupply: "export",
  defaultCurrency: "USD",
  taxId: "",
  primaryContact: "",
  billingAddress: "",
  deliveryAddress: "",
  gstin: "",
  state: "",
  defaultGstRate: "",
  defaultTaxTreatment: "igst",
  defaultSacCode: "",
  billingModel: "hourly",
  hourlyRate: "",
  fixedAmount: "",
  cyclePreset: "monthly",
  intervalUnit: "month",
  intervalCount: 1,
  cycleAnchorDate: "",
  autoDraft: false,
};

export function ClientFormSheet({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create; pass a client to edit it. */
  client?: Client;
}) {
  const allCurrencies = useLiveQuery(() => db.currencies.filter((c) => c.active).toArray(), []);
  const documents = useLiveQuery(
    () => (client ? db.clientDocuments.where("clientId").equals(client.id).toArray() : []),
    [client?.id]
  );

  const [staged, setStaged] = useState<StagedDocument[]>([]);
  const [tab, setTab] = useState("details");

  const form = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(schema),
    defaultValues: BLANK,
  });

  // Re-seed whenever the sheet opens, so editing one client then another doesn't
  // carry the previous one's values over.
  useEffect(() => {
    if (!open) return;
    form.reset(client ? toFormValues(client) : BLANK);
    setStaged([]);
    setTab("details");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id]);

  const placeOfSupply = form.watch("placeOfSupply");
  const billingModel = form.watch("billingModel");
  const cyclePreset = form.watch("cyclePreset");
  const autoDraft = form.watch("autoDraft");
  const isDomestic = placeOfSupply === "domestic";

  // The base currency is only on offer for a domestic supply. An export invoice
  // denominated in INR would have no foreign currency to realize a gain against,
  // which is the whole point of the forex module.
  const currencies = (allCurrencies ?? []).filter((currency) => isDomestic || !currency.isBase);

  function onPlaceOfSupplyChange(value: string) {
    form.setValue("placeOfSupply", value as "export" | "domestic");
    const selected = (allCurrencies ?? []).find((c) => c.code === form.getValues("defaultCurrency"));
    if (value === "export" && selected?.isBase) {
      form.setValue("defaultCurrency", "");
    }
    if (value === "domestic") {
      form.setValue("defaultTaxTreatment", form.getValues("defaultTaxTreatment") || "igst");
      if (!form.getValues("defaultGstRate")) {
        form.setValue("defaultGstRate", String(DEFAULT_DOMESTIC_GST_RATE));
      }
    }
  }

  function onCyclePresetChange(value: string) {
    form.setValue("cyclePreset", value);
    const preset = CYCLE_PRESETS.find((p) => p.id === value);
    if (preset) {
      form.setValue("intervalUnit", preset.cycle.intervalUnit);
      form.setValue("intervalCount", preset.cycle.intervalCount);
    }
  }

  /** Copies terms the extractor proposed into the form. Nothing is saved yet. */
  function applyAnalysis(analysis: ContractAnalysis) {
    const applied: string[] = [];

    const hourly = analysis.rates.find((rate) => rate.unit === "hour");
    const periodic = analysis.rates.find(
      (rate) => rate.unit === "month" || rate.unit === "year"
    );

    if (hourly) {
      form.setValue("billingModel", "hourly");
      form.setValue("hourlyRate", String(hourly.amount));
      applied.push(`hourly rate ${hourly.amount}`);
      if (hourly.currency && currencies.some((c) => c.code === hourly.currency)) {
        form.setValue("defaultCurrency", hourly.currency);
        applied.push(hourly.currency);
      }
    } else if (periodic) {
      form.setValue("billingModel", "fixed");
      form.setValue("fixedAmount", String(periodic.amount));
      onCyclePresetChange(periodic.unit === "year" ? "yearly" : "monthly");
      applied.push(`${periodic.unit}ly amount ${periodic.amount}`);
      if (periodic.currency && currencies.some((c) => c.code === periodic.currency)) {
        form.setValue("defaultCurrency", periodic.currency);
        applied.push(periodic.currency);
      }
    }

    if (analysis.effectiveDate) {
      form.setValue("cycleAnchorDate", analysis.effectiveDate);
      applied.push(`billing anchored to ${analysis.effectiveDate}`);
    }

    if (applied.length === 0) {
      toast.message("Nothing to copy across", {
        description: "The document had no rate or effective date this form has a home for.",
      });
      return;
    }

    setTab("billing");
    toast.success("Filled in from the contract", {
      description: `${applied.join(", ")}. Check each against the document before saving.`,
    });
  }

  async function onSubmit(values: ParsedValues) {
    try {
      const input = toClientInput(values, client);
      const id = client ? client.id : (await createClient(input)).id;
      if (client) await updateClient(client.id, input);

      for (const document of staged) {
        await attachClientDocument({
          clientId: id,
          kind: document.kind,
          file: document.file,
          analysis: document.analysis,
        });
      }

      toast.success(client ? `${values.name} updated.` : `${values.name} added.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this client.");
    }
  }

  async function onDeleteDocument(id: string) {
    try {
      await deleteClientDocument(id);
      toast.success("Document deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete that document.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{client ? "Edit client" : "New client"}</SheetTitle>
          <SheetDescription>
            {client
              ? "Invoices already issued keep the details they were created with — this only affects new ones."
              : "Stored locally on this device. Used to pre-fill invoices."}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            id="client-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col overflow-hidden px-4"
          >
            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="w-full">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="billing">Billing</TabsTrigger>
                <TabsTrigger value="documents">
                  Documents
                  {staged.length + (documents?.length ?? 0) > 0 &&
                    ` (${staged.length + (documents?.length ?? 0)})`}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client name</FormLabel>
                      <FormControl>
                        <Input placeholder="Acme Inc." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="placeOfSupply"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Place of supply</FormLabel>
                      <Select value={field.value} onValueChange={onPlaceOfSupplyChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="export">
                            Export of services — outside India
                          </SelectItem>
                          <SelectItem value="domestic">Domestic supply — within India</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {isDomestic
                          ? "Invoices carry the GST rate you state below. The app records that rate; it does not decide what is owed."
                          : "Invoices are zero-rated under LUT and carry the IGST export disclaimer."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <FormControl>
                          <Input placeholder={isDomestic ? "India" : "United States"} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="defaultCurrency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default currency</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {currencies.map((currency) => (
                              <SelectItem key={currency.code} value={currency.code}>
                                {currency.code} — {currency.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Pre-fills new invoices; editable per invoice.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {isDomestic && (
                  <div className="space-y-4 rounded-lg border p-3">
                    <p className="text-sm font-medium">Domestic tax details</p>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="gstin"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Client GSTIN</FormLabel>
                            <FormControl>
                              <Input placeholder="29ABCDE1234F1Z5" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input placeholder="Karnataka" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="defaultTaxTreatment"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tax treatment</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
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
                            <FormDescription>
                              Which one applies is your call — the app just prints it.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="defaultGstRate"
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
                            <FormDescription>
                              {DEFAULT_DOMESTIC_GST_RATE}% is offered because it is common for
                              consultancy, not because the app worked out that it applies.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                  </div>
                )}

                <FormField
                  control={form.control}
                  name="defaultSacCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SAC code</FormLabel>
                      <FormControl>
                        <Input placeholder="998313" {...field} />
                      </FormControl>
                      <FormDescription>
                        Services Accounting Code. Rule 46(g) wants it on an export invoice too, not
                        only on a domestic one.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="primaryContact"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary contact</FormLabel>
                      <FormControl>
                        <Input placeholder="Name or email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="taxId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax ID</FormLabel>
                      <FormControl>
                        <Input placeholder="VAT / EIN / TIN" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="billingAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Billing address</FormLabel>
                      <FormControl>
                        <Textarea rows={3} placeholder="Street, City, State, ZIP" {...field} />
                      </FormControl>
                      <FormDescription>
                        Printed on the invoice as the recipient block.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deliveryAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address of delivery</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={2}
                          placeholder="Leave blank if the same as the billing address"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Where the service is actually delivered. Rule 46 requires it on an export
                        invoice; blank prints the billing address instead.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="billing" className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-2">
                <FormField
                  control={form.control}
                  name="billingModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Billing style</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="hourly">Hourly consultation</SelectItem>
                          <SelectItem value="fixed">Fixed payout per period</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {field.value === "hourly"
                          ? "Invoices are itemised by date, with hours and a rate per hour on each line."
                          : "Invoices carry one flat line per billing period."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {billingModel === "hourly" ? (
                  <FormField
                    control={form.control}
                    name="hourlyRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rate per hour</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="decimal"
                            placeholder="150"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormDescription>
                          In {form.watch("defaultCurrency") || "the client's currency"}. Pre-fills
                          each consultation line; editable per line.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <>
                    <FormField
                      control={form.control}
                      name="fixedAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount per period</FormLabel>
                          <FormControl>
                            <Input
                              inputMode="decimal"
                              placeholder="5000"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormDescription>
                            In {form.watch("defaultCurrency") || "the client's currency"}.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="cyclePreset"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Frequency</FormLabel>
                          <Select value={field.value} onValueChange={onCyclePresetChange}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {CYCLE_PRESETS.map((preset) => (
                                <SelectItem key={preset.id} value={preset.id}>
                                  {preset.label}
                                </SelectItem>
                              ))}
                              <SelectItem value="custom">Custom…</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {cyclePreset === "custom" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="intervalCount"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Every</FormLabel>
                              <FormControl>
                                <Input
                                  inputMode="numeric"
                                  placeholder="2"
                                  {...field}
                                  value={field.value ?? ""}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="intervalUnit"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Unit</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="week">Weeks</SelectItem>
                                  <SelectItem value="month">Months</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

                    <FormField
                      control={form.control}
                      name="cycleAnchorDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First period starts</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormDescription>
                            Periods are counted forward from this date.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="autoDraft"
                      render={({ field }) => (
                        <FormItem className="rounded-lg border p-3">
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                              <FormLabel>Draft invoices automatically</FormLabel>
                              <FormDescription>
                                A draft is raised when a period has fully elapsed — never for time
                                that has not happened yet, and never twice for the same period.
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </div>
                          {field.value && (
                            <p className="text-muted-foreground mt-3 text-xs">
                              Each auto-draft takes an invoice serial number, and serials are never
                              reissued. A period you draft and then delete leaves a permanent gap in
                              the series that you will have to explain to your CA.
                            </p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {billingModel === "fixed" && autoDraft && (
                  <p className="text-muted-foreground text-xs">
                    Next drafts:{" "}
                    {describeCycle(cycleFromValues(form.getValues() as ParsedValues))}, from{" "}
                    {form.watch("cycleAnchorDate") || "a date you have not set yet"}.
                  </p>
                )}
              </TabsContent>

              <TabsContent
                value="documents"
                className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-2"
              >
                <ContractUploadPanel
                  staged={staged}
                  onStagedChange={setStaged}
                  existing={documents ?? []}
                  onDelete={client ? onDeleteDocument : undefined}
                  onApply={applyAnalysis}
                />
                {!client && staged.length > 0 && (
                  <p className="text-muted-foreground text-xs">
                    Attached once the client is saved.
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </form>
        </Form>

        <SheetFooter>
          <Button type="submit" form="client-form" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            {client ? "Save changes" : "Add client"}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function cycleFromValues(values: ParsedValues): BillingCycle {
  const preset = CYCLE_PRESETS.find((p) => p.id === values.cyclePreset);
  if (preset) return preset.cycle;
  return {
    intervalUnit: values.intervalUnit,
    intervalCount: Math.max(1, Math.round(values.intervalCount ?? 1)),
  };
}

function toClientInput(values: ParsedValues, existing?: Client): ClientInput {
  const isDomestic = values.placeOfSupply === "domestic";

  return {
    name: values.name,
    country: values.country,
    placeOfSupply: values.placeOfSupply,
    defaultCurrency: values.defaultCurrency,
    billingAddress: values.billingAddress || undefined,
    deliveryAddress: values.deliveryAddress || undefined,
    taxId: values.taxId || undefined,
    primaryContact: values.primaryContact || undefined,

    // An overseas recipient has no GSTIN and no Indian state. Clearing them on
    // reclassification stops a stale domestic field printing on an export invoice.
    gstin: isDomestic ? values.gstin || undefined : undefined,
    state: isDomestic ? values.state || undefined : undefined,
    defaultGstRate: isDomestic ? values.defaultGstRate : undefined,
    defaultTaxTreatment: isDomestic ? values.defaultTaxTreatment : undefined,
    // Not domestic-only, unlike the rate and the treatment: an export invoice
    // carries an accounting code for the service just the same (Rule 46(g)).
    defaultSacCode: values.defaultSacCode || undefined,

    billing: {
      model: values.billingModel,
      hourlyRate: values.billingModel === "hourly" ? values.hourlyRate : undefined,
      fixedAmount: values.billingModel === "fixed" ? values.fixedAmount : undefined,
      cycle: values.billingModel === "fixed" ? cycleFromValues(values) : undefined,
      cycleAnchorDate:
        values.billingModel === "fixed" ? values.cycleAnchorDate || undefined : undefined,
      autoDraft: values.billingModel === "fixed" && values.autoDraft,
      // Carried across untouched: it is a record of what has already been billed,
      // not a setting. Resetting it here would re-draft periods a second time.
      lastDraftedPeriodStart: existing?.billing.lastDraftedPeriodStart,
    },
  };
}

function toFormValues(client: Client): FormValues {
  const cycle = client.billing.cycle ?? DEFAULT_CYCLE;

  return {
    name: client.name,
    country: client.country,
    placeOfSupply: client.placeOfSupply,
    defaultCurrency: client.defaultCurrency,
    taxId: client.taxId ?? "",
    primaryContact: client.primaryContact ?? "",
    billingAddress: client.billingAddress ?? "",
    deliveryAddress: client.deliveryAddress ?? "",

    gstin: client.gstin ?? "",
    state: client.state ?? "",
    defaultGstRate: client.defaultGstRate === undefined ? "" : String(client.defaultGstRate),
    defaultTaxTreatment: client.defaultTaxTreatment ?? "igst",
    defaultSacCode: client.defaultSacCode ?? "",

    billingModel: client.billing.model,
    hourlyRate: client.billing.hourlyRate === undefined ? "" : String(client.billing.hourlyRate),
    fixedAmount: client.billing.fixedAmount === undefined ? "" : String(client.billing.fixedAmount),
    cyclePreset: presetIdFor(client.billing.cycle),
    intervalUnit: cycle.intervalUnit,
    intervalCount: cycle.intervalCount,
    cycleAnchorDate: client.billing.cycleAnchorDate ?? "",
    autoDraft: client.billing.autoDraft,
  };
}
