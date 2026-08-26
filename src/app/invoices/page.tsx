"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, ScrollText, Search } from "lucide-react";

import { PageHeader } from "@/components/app-shell/page-header";
import { MobileFab } from "@/components/app-shell/mobile-fab";
import { InvoiceFormSheet } from "@/components/invoices/invoice-form-sheet";
import { InvoiceDetailSheet } from "@/components/invoices/invoice-detail-sheet";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import type { Invoice, InvoiceStatus, Remittance } from "@/lib/types";
import { deriveInvoiceStatus } from "@/lib/invoices";
import { getEntityProfile } from "@/lib/entity-profile";
import { formatMoney, invoiceTotalFcy } from "@/lib/money";
import { formatFinancialYear, parseIsoDate, recentFinancialYears } from "@/lib/fy";

const ALL = "__all__";
const STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "overdue"];

export default function InvoicesPage() {
  const profile = useLiveQuery(() => getEntityProfile(), []);
  const invoices = useLiveQuery(
    () => db.invoices.orderBy("serialNumber").reverse().toArray(),
    []
  );
  const remittances = useLiveQuery(() => db.remittances.toArray(), [], [] as Remittance[]);
  const clientCount = useLiveQuery(() => db.clients.filter((c) => !c.archived).count(), []);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [financialYear, setFinancialYear] = useState<string>(ALL);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | undefined>();
  const [selected, setSelected] = useState<Invoice | null>(null);

  const byInvoice = useMemo(() => {
    const map = new Map<string, Remittance[]>();
    for (const remittance of remittances) {
      const list = map.get(remittance.invoiceId);
      if (list) list.push(remittance);
      else map.set(remittance.invoiceId, [remittance]);
    }
    return map;
  }, [remittances]);

  // Offer every FY that has invoices, plus the recent ones, so the filter is
  // useful before any invoice exists and never hides an old financial year.
  const financialYears = useMemo(() => {
    const fromData = new Set((invoices ?? []).map((i) => i.financialYear));
    for (const fy of recentFinancialYears(3)) fromData.add(fy);
    return Array.from(fromData).sort().reverse();
  }, [invoices]);

  const rows = useMemo(
    () =>
      (invoices ?? [])
        .map((invoice) => ({
          invoice,
          status: deriveInvoiceStatus(invoice, byInvoice.get(invoice.id) ?? []),
        }))
        .filter(({ invoice, status: derived }) => {
          if (status !== ALL && derived !== status) return false;
          if (financialYear !== ALL && invoice.financialYear !== financialYear) return false;
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return (
            invoice.serialNumber.toLowerCase().includes(q) ||
            invoice.clientSnapshot.name.toLowerCase().includes(q)
          );
        }),
    [invoices, byInvoice, status, financialYear, query]
  );

  // The detail sheet holds a snapshot; re-read from the live list so status and
  // amount changes made inside it are reflected without reopening.
  const selectedLive = selected
    ? ((invoices ?? []).find((i) => i.id === selected.id) ?? null)
    : null;

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }

  const loading = invoices === undefined || profile === undefined;
  const noClients = clientCount === 0;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Foreign-currency export invoices with LUT/IGST compliance."
        actions={
          <Button onClick={openCreate} disabled={noClients} className="hidden md:inline-flex">
            <Plus data-icon="inline-start" />
            New invoice
          </Button>
        }
      />

      <div className="space-y-4 p-4 sm:p-6">
        {noClients && (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              Add a client first — an invoice needs one to snapshot the billing details from.
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search serial or client"
              className="pl-8"
              aria-label="Search invoices"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUSES.map((value) => (
                <SelectItem key={value} value={value} className="capitalize">
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={financialYear} onValueChange={setFinancialYear}>
            <SelectTrigger className="sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All financial years</SelectItem>
              {financialYears.map((fy) => (
                <SelectItem key={fy} value={fy}>
                  {formatFinancialYear(fy)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
              <ScrollText className="size-10" />
              <p className="text-base">
                {(invoices ?? []).length === 0
                  ? "No invoices yet."
                  : "No invoices match these filters."}
              </p>
              {(invoices ?? []).length === 0 && !noClients && (
                <Button variant="outline" onClick={openCreate}>
                  <Plus data-icon="inline-start" />
                  New invoice
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Desktop: dense table. Mobile: tappable cards — a five-column table
                would force horizontal scrolling on a phone. */}
            <Card className="hidden overflow-x-auto py-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Serial</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Invoice date</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">INR (books)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ invoice, status: derived }) => (
                    <TableRow
                      key={invoice.id}
                      onClick={() => setSelected(invoice)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-mono font-medium">{invoice.serialNumber}</TableCell>
                      <TableCell>{invoice.clientSnapshot.name}</TableCell>
                      <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
                      <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(invoiceTotalFcy(invoice), invoice.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatMoney(
                          invoiceTotalFcy(invoice) * invoice.invoiceDateFxRate,
                          "INR"
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={derived} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <div className="grid gap-3 md:hidden">
              {rows.map(({ invoice, status: derived }) => (
                <Card key={invoice.id} onClick={() => setSelected(invoice)}>
                  <CardContent className="space-y-2 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-medium">{invoice.serialNumber}</p>
                        <p className="truncate text-base">{invoice.clientSnapshot.name}</p>
                      </div>
                      <StatusBadge status={derived} />
                    </div>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">
                        Due {formatDate(invoice.dueDate)}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {formatMoney(invoiceTotalFcy(invoice), invoice.currency)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {!noClients && <MobileFab onClick={openCreate} label="New invoice" />}

      {profile && (
        <InvoiceFormSheet
          open={formOpen}
          onOpenChange={setFormOpen}
          profile={profile}
          invoice={editing}
        />
      )}

      {profile && selectedLive && (
        <InvoiceDetailSheet
          invoice={selectedLive}
          profile={profile}
          onOpenChange={(open) => !open && setSelected(null)}
          onEdit={(invoice) => {
            setSelected(null);
            setEditing(invoice);
            setFormOpen(true);
          }}
        />
      )}
    </>
  );
}

function formatDate(isoDate: string): string {
  return parseIsoDate(isoDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
