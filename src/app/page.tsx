"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, FileClock, ScrollText, TrendingUp, TriangleAlert, Users } from "lucide-react";

import { PageHeader } from "@/components/app-shell/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { BASE_CURRENCY_CODE } from "@/lib/currencies";
import { deriveInvoiceStatus } from "@/lib/invoices";
import { formatMoney, formatSignedMoney, invoiceTotalFcy, round2 } from "@/lib/money";
import { financialYearOf, parseIsoDate } from "@/lib/fy";
import { getEntityProfile, unconfirmedProfileFields } from "@/lib/entity-profile";

/**
 * Dashboard metrics are derived from the same helpers the detail views use
 * (`deriveInvoiceStatus`, the money helpers) rather than recomputed here, so a
 * figure on this page can never disagree with the page it links to.
 */
function useDashboardData() {
  return useLiveQuery(async () => {
    const currentFy = financialYearOf(new Date());
    const [invoices, remittances, clientCount, profile] = await Promise.all([
      db.invoices.toArray(),
      db.remittances.toArray(),
      db.clients.filter((c) => !c.archived).count(),
      getEntityProfile(),
    ]);

    const byInvoice = new Map<string, typeof remittances>();
    for (const remittance of remittances) {
      const list = byInvoice.get(remittance.invoiceId);
      if (list) list.push(remittance);
      else byInvoice.set(remittance.invoiceId, [remittance]);
    }

    const open = invoices
      .map((invoice) => ({
        invoice,
        status: deriveInvoiceStatus(invoice, byInvoice.get(invoice.id) ?? []),
      }))
      .filter(({ status }) => status === "sent" || status === "overdue");

    const pendingInr = round2(
      open.reduce(
        (sum, { invoice }) => sum + invoiceTotalFcy(invoice) * invoice.invoiceDateFxRate,
        0
      )
    );

    // Realized gain/loss is attributed to the financial year the *invoice* falls
    // in, matching how the income it varies against was booked.
    const invoiceFyById = new Map(invoices.map((i) => [i.id, i.financialYear]));
    const realizedThisFy = round2(
      remittances
        .filter((r) => invoiceFyById.get(r.invoiceId) === currentFy)
        .reduce((sum, r) => sum + r.realizedForexGainLoss, 0)
    );

    const overdue = open
      .filter(({ status }) => status === "overdue")
      .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate))
      .slice(0, 5);

    return {
      currentFy,
      invoiceCount: invoices.length,
      openCount: open.length,
      pendingInr,
      realizedThisFy,
      clientCount,
      overdue,
      profileGaps: unconfirmedProfileFields(profile),
    };
  }, []);
}

export default function DashboardPage() {
  const data = useDashboardData();

  return (
    <>
      <PageHeader title="Dashboard" description="Rahul Goel HUF — bookkeeping overview." />

      <div className="space-y-4 p-4 sm:p-6">
        {data && data.profileGaps.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-muted-foreground flex gap-2 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  Invoices will print with{" "}
                  <span className="text-foreground font-medium">
                    {data.profileGaps.join(", ")}
                  </span>{" "}
                  unconfirmed. PDFs still generate — correct these when you have them.
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link href="/settings">
                  Open settings
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={ScrollText}
            label="Total Invoices"
            value={data && String(data.invoiceCount)}
          />
          <MetricCard
            icon={FileClock}
            label="Pending Receivables"
            value={data && formatMoney(data.pendingInr, BASE_CURRENCY_CODE)}
            hint={data && `${data.openCount} open invoice${data.openCount === 1 ? "" : "s"}`}
          />
          <MetricCard
            icon={TrendingUp}
            label="Realized Forex (this FY)"
            value={data && formatSignedMoney(data.realizedThisFy, BASE_CURRENCY_CODE)}
            hint={data && `FY 20${data.currentFy}`}
            tone={data && data.realizedThisFy < 0 ? "negative" : "positive"}
          />
          <MetricCard icon={Users} label="Clients" value={data && String(data.clientCount)} />
        </div>

        {data && data.overdue.length > 0 && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Overdue invoices</CardTitle>
              <Button asChild size="sm" variant="ghost">
                <Link href="/ar-aging">
                  AR aging
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="divide-y">
              {data.overdue.map(({ invoice, status }) => (
                <div key={invoice.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium">{invoice.serialNumber}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {invoice.clientSnapshot.name} · due{" "}
                      {parseIsoDate(invoice.dueDate).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular-nums">
                      {formatMoney(invoiceTotalFcy(invoice), invoice.currency)}
                    </span>
                    <StatusBadge status={status} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  /** `undefined` while the live query is still resolving — renders a skeleton, never a misleading zero. */
  value: string | undefined | null | false;
  hint?: string | false;
  tone?: "positive" | "negative" | false;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {!value ? (
          <Skeleton className="h-9 w-28" />
        ) : (
          <div
            className={
              tone === "negative"
                ? "text-2xl font-semibold tabular-nums text-status-overdue"
                : "text-2xl font-semibold tabular-nums"
            }
          >
            {value}
          </div>
        )}
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
