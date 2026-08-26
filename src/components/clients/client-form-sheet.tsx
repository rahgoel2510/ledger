"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import type { Client } from "@/lib/types";
import { createClient, updateClient } from "@/lib/clients";

const schema = z.object({
  name: z.string().trim().min(1, "Required."),
  country: z.string().trim().min(1, "Required — drives the export-of-services treatment."),
  defaultCurrency: z.string().trim().min(1, "Required."),
  taxId: z.string().trim().optional(),
  primaryContact: z.string().trim().optional(),
  billingAddress: z.string().trim().optional(),
});

type FormValues = z.infer<typeof schema>;

const BLANK: FormValues = {
  name: "",
  country: "",
  defaultCurrency: "USD",
  taxId: "",
  primaryContact: "",
  billingAddress: "",
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
  const currencies = useLiveQuery(
    () => db.currencies.filter((c) => c.active && !c.isBase).toArray(),
    []
  );

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: BLANK });

  // Re-seed whenever the sheet opens, so editing one client then another doesn't
  // carry the previous one's values over.
  useEffect(() => {
    if (open) form.reset(client ? toFormValues(client) : BLANK);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id]);

  async function onSubmit(values: FormValues) {
    try {
      if (client) {
        await updateClient(client.id, values);
        toast.success(`${values.name} updated.`);
      } else {
        await createClient(values);
        toast.success(`${values.name} added.`);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this client.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
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
            className="flex-1 space-y-4 overflow-y-auto px-4"
          >
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <Input placeholder="United States" {...field} />
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
                        {(currencies ?? []).map((currency) => (
                          <SelectItem key={currency.code} value={currency.code}>
                            {currency.code} — {currency.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Pre-fills new invoices; editable per invoice.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                  <FormDescription>Printed on the invoice as the recipient block.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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

function toFormValues(client: Client): FormValues {
  return {
    name: client.name,
    country: client.country,
    defaultCurrency: client.defaultCurrency,
    taxId: client.taxId ?? "",
    primaryContact: client.primaryContact ?? "",
    billingAddress: client.billingAddress ?? "",
  };
}
