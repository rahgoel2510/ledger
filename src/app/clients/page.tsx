"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Pencil, Plus, Search, Users } from "lucide-react";

import { PageHeader } from "@/components/app-shell/page-header";
import { MobileFab } from "@/components/app-shell/mobile-fab";
import { ClientFormSheet } from "@/components/clients/client-form-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { db } from "@/lib/db";
import type { Client } from "@/lib/types";
import { matchesClientSearch, removeClient, restoreClient } from "@/lib/clients";
import { DEFAULT_CYCLE, describeCycle, isRecurring } from "@/lib/recurring";
import { formatMoney } from "@/lib/money";

const ALL_COUNTRIES = "__all__";

export default function ClientsPage() {
  const clients = useLiveQuery(() => db.clients.orderBy("name").toArray(), []);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState(ALL_COUNTRIES);
  const [editing, setEditing] = useState<Client | undefined>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<Client | null>(null);

  // Country filter options come from the data itself — a fixed ISO list would be
  // 200 entries of noise for a directory that realistically holds a handful.
  const countries = useMemo(
    () => Array.from(new Set((clients ?? []).map((c) => c.country))).sort(),
    [clients]
  );

  const visible = useMemo(
    () =>
      (clients ?? []).filter(
        (client) =>
          matchesClientSearch(client, query) &&
          (country === ALL_COUNTRIES || client.country === country)
      ),
    [clients, query, country]
  );

  function openCreate() {
    setEditing(undefined);
    setSheetOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setSheetOpen(true);
  }

  async function confirmRemoval() {
    if (!pendingRemoval) return;
    try {
      const outcome = await removeClient(pendingRemoval.id);
      toast.success(
        outcome === "archived"
          ? `${pendingRemoval.name} archived — their invoices are untouched.`
          : `${pendingRemoval.name} deleted.`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove this client.");
    } finally {
      setPendingRemoval(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Clients"
        description="Billing details reused across invoices, reports, and AR aging."
        actions={
          <Button onClick={openCreate} className="hidden md:inline-flex">
            <Plus data-icon="inline-start" />
            New client
          </Button>
        }
      />

      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, contact, or tax ID"
              className="pl-8"
              aria-label="Search clients"
            />
          </div>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger className="sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_COUNTRIES}>All countries</SelectItem>
              {countries.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {clients === undefined ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
              <Users className="size-10" />
              <p className="text-base">
                {clients.length === 0
                  ? "No clients yet. Add one to start invoicing."
                  : "No clients match this search."}
              </p>
              {clients.length === 0 && (
                <Button onClick={openCreate} variant="outline">
                  <Plus data-icon="inline-start" />
                  New client
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          /* Cards rather than a table: this list is read one-handed on a phone as
             often as on a desktop, and a table would force horizontal scrolling. */
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((client) => (
              <Card key={client.id} className={client.archived ? "opacity-60" : undefined}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-base font-semibold">{client.name}</h2>
                        {client.archived && <Badge variant="secondary">Archived</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{client.country}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge variant={client.placeOfSupply === "domestic" ? "secondary" : "outline"}>
                          {client.placeOfSupply === "domestic" ? "Domestic supply" : "Export of services"}
                        </Badge>
                        <Badge variant="outline">
                          {client.billing.model === "hourly"
                            ? "Hourly"
                            : describeCycle(client.billing.cycle ?? DEFAULT_CYCLE)}
                        </Badge>
                        {isRecurring(client) && <Badge variant="secondary">Auto-drafts</Badge>}
                      </div>
                    </div>
                    <Badge variant="outline" className="font-mono shrink-0">
                      {client.defaultCurrency}
                    </Badge>
                  </div>

                  <dl className="space-y-1 text-sm text-muted-foreground">
                    {client.primaryContact && (
                      <div className="flex gap-2">
                        <dt className="shrink-0">Contact:</dt>
                        <dd className="truncate text-foreground">{client.primaryContact}</dd>
                      </div>
                    )}
                    {client.taxId && (
                      <div className="flex gap-2">
                        <dt className="shrink-0">Tax ID:</dt>
                        <dd className="truncate text-foreground">{client.taxId}</dd>
                      </div>
                    )}
                    {client.billing.model === "hourly" && client.billing.hourlyRate !== undefined && (
                      <div className="flex gap-2">
                        <dt className="shrink-0">Rate:</dt>
                        <dd className="truncate text-foreground">
                          {formatMoney(client.billing.hourlyRate, client.defaultCurrency)} / hour
                        </dd>
                      </div>
                    )}
                    {client.billing.model === "fixed" && client.billing.fixedAmount !== undefined && (
                      <div className="flex gap-2">
                        <dt className="shrink-0">Retainer:</dt>
                        <dd className="truncate text-foreground">
                          {formatMoney(client.billing.fixedAmount, client.defaultCurrency)} /{" "}
                          {describeCycle(client.billing.cycle ?? DEFAULT_CYCLE).toLowerCase()}
                        </dd>
                      </div>
                    )}
                  </dl>

                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(client)}>
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                    {client.archived ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => restoreClient(client.id)}
                      >
                        <ArchiveRestore data-icon="inline-start" />
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPendingRemoval(client)}
                      >
                        <Archive data-icon="inline-start" />
                        Archive
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <MobileFab onClick={openCreate} label="New client" />

      <ClientFormSheet open={sheetOpen} onOpenChange={setSheetOpen} client={editing} />

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {pendingRemoval?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be hidden from new-invoice pickers. Any invoices already issued to them stay
              exactly as they are — nothing historical is deleted or altered. If they have no
              invoices at all, the record is removed outright.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoval}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
