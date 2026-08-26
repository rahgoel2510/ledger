"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Check, Loader2, Save, Search, TriangleAlert } from "lucide-react";

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
import {
  DEFAULT_SERIAL_PADDING,
  DEFAULT_SERIAL_PREFIX,
  formatSerialNumber,
} from "@/lib/serial";
import { financialYearOf } from "@/lib/fy";
import { optionalIntegerField } from "@/lib/form-schema";
import { missingProfileFields } from "@/lib/entity-profile";
import {
  describeBranch,
  isValidIfscFormat,
  lookupIfsc,
  normalizeIfsc,
  type IfscBranch,
} from "@/lib/ifsc";

/**
 * Every field here is optional to save.
 *
 * The profile is filled in over several sittings — the LUT number arrives weeks
 * after the GSTIN, the SWIFT code needs a call to the bank — and a form that
 * refuses to save until all of it is present just loses the half that was
 * already known. What a compliant invoice actually requires is enforced where it
 * matters instead: `missingProfileFields` gates PDF generation, and this form
 * surfaces the same list as a banner rather than as blocking field errors.
 *
 * Optional is not unvalidated. A value that is present but malformed — an email
 * without an `@`, twelve sequence digits — is still rejected, because that is a
 * typo rather than a deferral.
 */
const schema = z.object({
  legalName: z.string().trim(),
  address: z.string().trim(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address.")]),
  phone: z.string().trim(),
  pan: z.string().trim(),
  gstin: z.string().trim(),
  lutNumber: z.string().trim(),
  bankName: z.string().trim(),
  bankAccountNumber: z.string().trim(),
  bankIfsc: z.string().trim().toUpperCase(),
  bankSwift: z.string().trim().toUpperCase(),
  bankBranch: z.string().trim(),
  invoiceSerialPrefix: z.string().trim(),
  invoiceSerialPadding: optionalIntegerField(
    "Use between 1 and 8 digits.",
    1,
    8,
    DEFAULT_SERIAL_PADDING
  ),
  defaultPaymentTermsDays: optionalIntegerField("Use between 0 and 365 days.", 0, 365, 30),
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

  const values = form.watch();

  const serialPreview = formatSerialNumber(
    {
      invoiceSerialPrefix: values.invoiceSerialPrefix || DEFAULT_SERIAL_PREFIX,
      invoiceSerialPadding: Number(values.invoiceSerialPadding) || DEFAULT_SERIAL_PADDING,
    },
    financialYearOf(new Date()),
    1
  );

  // Read from the live form rather than the saved row, so the banner clears as
  // the gaps are typed in instead of only after a save.
  const gaps = missingProfileFields({ ...profile, ...values } as EntityProfile);

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
      {/*
        `noValidate` hands validation entirely to zod. Without it the browser's
        own check on `type="email"` blocks submission first, with a tooltip that
        contradicts this form's rules — it treats a malformed address as fatal
        while everything here is optional, and it fires before the resolver ever
        runs, so the field-level message never appears.
      */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {gaps.length > 0 && (
          <Card className="border-status-overdue/30 bg-status-overdue-bg">
            <CardContent className="flex gap-2 py-4 text-sm text-status-overdue">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>
                Save as much or as little as you like — but an invoice PDF cannot be generated
                until <span className="font-medium">{gaps.join(", ")}</span>{" "}
                {gaps.length === 1 ? "is" : "are"} filled in.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Entity particulars</CardTitle>
            <CardDescription>
              Printed as the supplier block on every invoice. Every field is optional — fill in
              what you have now and come back for the rest.
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
              Shown on every invoice so overseas clients can remit in foreign currency. Enter the
              IFSC and the bank and branch are looked up for you — a wrong digit here means a
              failed transfer.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <IfscField form={form} />
            <TextField form={form} name="bankAccountNumber" label="Account number" />
            <TextField form={form} name="bankName" label="Bank name" />
            <TextField form={form} name="bankBranch" label="Branch" />
            <TextField
              form={form}
              name="bankSwift"
              label="SWIFT / BIC code"
              className="sm:col-span-2"
              description="Required for international wires. Most branches do not publish it — ask your bank if the lookup leaves it blank."
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
            <TextField
              form={form}
              name="invoiceSerialPrefix"
              label="Serial prefix"
              placeholder={DEFAULT_SERIAL_PREFIX}
            />
            <TextField
              form={form}
              name="invoiceSerialPadding"
              label="Sequence digits"
              type="number"
              placeholder={String(DEFAULT_SERIAL_PADDING)}
            />
            <TextField
              form={form}
              name="defaultPaymentTermsDays"
              label="Default payment terms (days)"
              type="number"
              placeholder="30"
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

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; branch: IfscBranch }
  | { kind: "not-found" }
  | { kind: "unavailable"; reason: string };

/** How long to wait after the last keystroke before asking the directory. */
const LOOKUP_DEBOUNCE_MS = 500;

/**
 * The IFSC field, with branch lookup attached.
 *
 * Resolved details fill only the fields that are still empty. Overwriting
 * something already typed is offered as a button instead: the directory is
 * usually right, but the person who called their bank this morning may be
 * righter, and silently replacing their answer would be the worse failure.
 */
function IfscField({ form }: { form: UseFormReturn<FormValues> }) {
  const raw = (form.watch("bankIfsc") ?? "") as string;
  const code = normalizeIfsc(raw);

  // The result is stored with the code it belongs to, and read back only when
  // the two still match. Deriving "idle" that way keeps the effect from having
  // to reset state on every keystroke, which would cascade a render each time.
  const [result, setResult] = useState<{ code: string; state: LookupState } | null>(null);
  const state: LookupState = result?.code === code ? result.state : { kind: "idle" };

  // Which code has already been asked about, so an unchanged field is not
  // re-looked-up on every re-render of the form.
  const resolvedFor = useRef<string>("");

  const run = useCallback(
    async (target: string, signal?: AbortSignal) => {
      setResult({ code: target, state: { kind: "loading" } });
      const lookup = await lookupIfsc(target, signal);
      if (signal?.aborted) return;

      resolvedFor.current = target;
      const setState = (next: LookupState) => setResult({ code: target, state: next });

      if (lookup.status === "found") {
        const result = lookup;
        setState({ kind: "found", branch: result.branch });
        // Fill the blanks only; anything already entered is left alone.
        const current = form.getValues();
        if (!String(current.bankName ?? "").trim() && result.branch.bank) {
          form.setValue("bankName", result.branch.bank, { shouldDirty: true });
        }
        if (!String(current.bankBranch ?? "").trim() && result.branch.branch) {
          form.setValue("bankBranch", result.branch.branch, { shouldDirty: true });
        }
        if (!String(current.bankSwift ?? "").trim() && result.branch.swift) {
          form.setValue("bankSwift", result.branch.swift, { shouldDirty: true });
        }
      } else if (lookup.status === "not-found") {
        setState({ kind: "not-found" });
      } else {
        setState({ kind: "unavailable", reason: lookup.reason });
      }
    },
    [form]
  );

  useEffect(() => {
    if (!isValidIfscFormat(code) || resolvedFor.current === code) return;

    const controller = new AbortController();
    const timer = setTimeout(() => void run(code, controller.signal), LOOKUP_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code, run]);

  function applyBranch(branch: IfscBranch) {
    if (branch.bank) form.setValue("bankName", branch.bank, { shouldDirty: true });
    if (branch.branch) form.setValue("bankBranch", branch.branch, { shouldDirty: true });
    if (branch.swift) form.setValue("bankSwift", branch.swift, { shouldDirty: true });
  }

  const values = form.getValues();
  const differs =
    state.kind === "found" &&
    ((!!state.branch.bank && state.branch.bank !== values.bankName) ||
      (!!state.branch.branch && state.branch.branch !== values.bankBranch));

  return (
    <FormField
      control={form.control}
      name="bankIfsc"
      render={({ field }) => (
        <FormItem>
          <FormLabel>IFSC code</FormLabel>
          <div className="flex gap-2">
            <FormControl>
              <Input
                placeholder="HDFC0000123"
                autoCapitalize="characters"
                spellCheck={false}
                {...field}
                value={(field.value ?? "") as string}
                onChange={(event) => field.onChange(normalizeIfsc(event.target.value))}
              />
            </FormControl>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Look up IFSC"
              disabled={!isValidIfscFormat(code) || state.kind === "loading"}
              onClick={() => {
                resolvedFor.current = "";
                void run(code);
              }}
            >
              {state.kind === "loading" ? <Loader2 className="animate-spin" /> : <Search />}
            </Button>
          </div>

          <IfscStatus state={state} differs={differs} onApply={applyBranch} />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function IfscStatus({
  state,
  differs,
  onApply,
}: {
  state: LookupState;
  differs: boolean;
  onApply: (branch: IfscBranch) => void;
}) {
  if (state.kind === "idle") {
    return <FormDescription>11 characters — the bank and branch fill in automatically.</FormDescription>;
  }

  if (state.kind === "loading") {
    return (
      <FormDescription className="flex items-center gap-1.5">
        <Loader2 className="size-3.5 animate-spin" />
        Looking up branch…
      </FormDescription>
    );
  }

  if (state.kind === "found") {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-status-paid">
        <span className="flex items-center gap-1.5">
          <Check className="size-3.5 shrink-0" />
          {describeBranch(state.branch)}
        </span>
        {differs && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => onApply(state.branch)}
          >
            Use these details
          </Button>
        )}
      </div>
    );
  }

  // Not-found and unavailable both mean the same thing to the user: type it in.
  return (
    <FormDescription className="text-status-overdue">
      {state.kind === "not-found"
        ? "No branch found for this IFSC — check the code, or enter the bank and branch manually."
        : state.reason}
    </FormDescription>
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
  placeholder,
}: {
  form: UseFormReturn<FormValues>;
  name: keyof FormValues;
  label: string;
  type?: string;
  className?: string;
  description?: string;
  placeholder?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type={type}
              placeholder={placeholder}
              {...field}
              value={(field.value ?? "") as string | number}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
