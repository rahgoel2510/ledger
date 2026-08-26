"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { ENTITY_PROFILE_ID, type EntityProfile } from "@/lib/types";
import { nowIso } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { formatSerialNumber } from "@/lib/serial";
import { financialYearOf } from "@/lib/fy";
import { integerField } from "@/lib/form-schema";

/**
 * Required fields mirror `REQUIRED_PROFILE_FIELDS` in lib/entity-profile.ts —
 * the bank wire block and GSTIN a compliant export invoice cannot omit. The rest
 * are optional so the form can be saved in stages.
 */
const schema = z.object({
  legalName: z.string().trim().min(1, "Required — appears as the supplier on every invoice."),
  address: z.string().trim().min(1, "Required — the supplier address on the invoice."),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address.")]),
  phone: z.string().trim(),
  pan: z.string().trim(),
  gstin: z.string().trim().min(1, "Required on a GST tax invoice."),
  lutNumber: z.string().trim(),
  bankName: z.string().trim().min(1, "Required — clients wire to this account."),
  bankAccountNumber: z.string().trim().min(1, "Required for the wire instructions."),
  bankIfsc: z.string().trim().min(1, "Required for the wire instructions."),
  bankSwift: z.string().trim().min(1, "Required for international transfers."),
  bankBranch: z.string().trim(),
  invoiceSerialPrefix: z.string().trim().min(1, "Required — the leading part of every serial."),
  invoiceSerialPadding: integerField("Use between 1 and 8 digits.", 1, 8),
  defaultPaymentTermsDays: integerField("Use between 0 and 365 days.", 0, 365),
});

type FormValues = z.input<typeof schema>;

export function EntityProfileForm({ profile }: { profile: EntityProfile }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(profile),
  });

  // The profile arrives from a live query, so it can land after first paint.
  // Reset only while the form is pristine — never stomp on edits in progress.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toFormValues(profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const serialPreview = formatSerialNumber(
    {
      invoiceSerialPrefix: form.watch("invoiceSerialPrefix") || "RGHUF/INV",
      invoiceSerialPadding: Number(form.watch("invoiceSerialPadding")) || 3,
    },
    financialYearOf(new Date()),
    1
  );

  async function onSubmit(values: FormValues) {
    const parsed = schema.parse(values);
    const next: EntityProfile = { ...parsed, id: ENTITY_PROFILE_ID, updatedAt: nowIso() };

    await db.transaction("rw", db.entityProfile, db.auditLog, async (tx) => {
      await db.entityProfile.put(next);
      await recordAudit(
        {
          actionType: "entity_profile_updated",
          entityType: "settings",
          entityId: ENTITY_PROFILE_ID,
          summary: "Entity profile and bank details updated",
          before: profile,
          after: next,
        },
        tx
      );
    });

    form.reset(toFormValues(next));
    toast.success("Entity profile saved.");
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Entity particulars</CardTitle>
            <CardDescription>
              Printed as the supplier block on every invoice. Fields marked required are needed
              before an invoice can be issued.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="legalName" label="Legal name" className="sm:col-span-2" />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Street, City, State, PIN, India" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <TextField form={form} name="email" label="Email" type="email" />
            <TextField form={form} name="phone" label="Phone" />
            <TextField form={form} name="pan" label="PAN" />
            <TextField form={form} name="gstin" label="GSTIN" />
            <TextField
              form={form}
              name="lutNumber"
              label="LUT number"
              className="sm:col-span-2"
              description="Letter of Undertaking reference, printed beside the zero-rated IGST disclaimer."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bank wire details</CardTitle>
            <CardDescription>
              Shown on every invoice so overseas clients can remit in foreign currency. All four
              required fields must be correct — a wrong digit here means a failed transfer.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="bankName" label="Bank name" />
            <TextField form={form} name="bankBranch" label="Branch" />
            <TextField form={form} name="bankAccountNumber" label="Account number" />
            <TextField form={form} name="bankIfsc" label="IFSC code" />
            <TextField
              form={form}
              name="bankSwift"
              label="SWIFT / BIC code"
              className="sm:col-span-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice numbering</CardTitle>
            <CardDescription>
              Serials run <code>{"{prefix}/{FY}/{seq}"}</code> and increment per financial year. A
              number is never reused, so deleting an invoice leaves a documented gap.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <TextField form={form} name="invoiceSerialPrefix" label="Serial prefix" />
            <TextField
              form={form}
              name="invoiceSerialPadding"
              label="Sequence digits"
              type="number"
            />
            <TextField
              form={form}
              name="defaultPaymentTermsDays"
              label="Default payment terms (days)"
              type="number"
            />
            <p className="text-sm text-muted-foreground sm:col-span-3">
              Next invoice this financial year would be{" "}
              <span className="font-mono font-medium text-foreground">{serialPreview}</span>
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            Save profile
          </Button>
        </div>
      </form>
    </Form>
  );
}

function toFormValues(profile: EntityProfile): FormValues {
  // `id` and `updatedAt` are managed by the store, not edited on the form.
  const { id, updatedAt, ...rest } = profile;
  void id;
  void updatedAt;
  return rest;
}

function TextField({
  form,
  name,
  label,
  type = "text",
  className,
  description,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  name: keyof FormValues;
  label: string;
  type?: string;
  className?: string;
  description?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} {...field} value={(field.value ?? "") as string | number} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
