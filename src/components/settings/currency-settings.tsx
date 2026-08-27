"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { BASE_CURRENCY_CODE } from "@/lib/currencies";
import { recordAudit } from "@/lib/audit";
import { enqueueSync } from "@/lib/sync";

/**
 * Currency list management (module 1, US-4). Deactivating never deletes: a
 * currency an old invoice was issued in has to keep resolving, so `active` only
 * controls whether it appears in new-invoice pickers.
 */
export function CurrencySettings() {
  const currencies = useLiveQuery(() => db.currencies.orderBy("code").toArray(), []);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  async function toggleActive(currencyCode: string, active: boolean) {
    if (currencyCode === BASE_CURRENCY_CODE) return;
    await db.transaction("rw", db.currencies, db.auditLog, db.syncQueue, async (tx) => {
      await db.currencies.update(currencyCode, { active });
      await enqueueSync(tx, "currencies", currencyCode);
      await recordAudit(
        {
          actionType: "currency_settings_changed",
          entityType: "settings",
          entityId: currencyCode,
          summary: `${currencyCode} ${active ? "activated" : "deactivated"}`,
        },
        tx
      );
    });
  }

  async function addCurrency() {
    const normalized = code.trim().toUpperCase();
    if (!normalized || !name.trim()) {
      toast.error("Currency code and name are both required.");
      return;
    }
    if (await db.currencies.get(normalized)) {
      toast.error(`${normalized} is already in the list.`);
      return;
    }

    await db.transaction("rw", db.currencies, db.auditLog, db.syncQueue, async (tx) => {
      await db.currencies.add({
        code: normalized,
        name: name.trim(),
        symbol: symbol.trim() || normalized,
        isBase: false,
        active: true,
      });
      await enqueueSync(tx, "currencies", normalized);
      await recordAudit(
        {
          actionType: "currency_settings_changed",
          entityType: "settings",
          entityId: normalized,
          summary: `${normalized} (${name.trim()}) added`,
        },
        tx
      );
    });

    setCode("");
    setName("");
    setSymbol("");
    toast.success(`${normalized} added.`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Currencies</CardTitle>
        <CardDescription>
          Controls which currencies you can invoice in. Deactivating one hides it from new invoices
          but leaves existing invoices in that currency untouched.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="divide-y rounded-lg border">
          {currencies === undefined
            ? Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center justify-between p-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-5 w-10" />
                </div>
              ))
            : currencies.map((currency) => (
                <div key={currency.code} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{currency.code}</span>
                      <span className="text-muted-foreground">{currency.symbol}</span>
                      {currency.isBase && <Badge variant="secondary">Base</Badge>}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{currency.name}</p>
                  </div>
                  <Switch
                    checked={currency.active}
                    disabled={currency.isBase}
                    onCheckedChange={(next) => toggleActive(currency.code, next)}
                    aria-label={`${currency.code} active`}
                  />
                </div>
              ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-[6rem_1fr_6rem_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor="new-currency-code">Code</Label>
            <Input
              id="new-currency-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CHF"
              maxLength={6}
              className="font-mono uppercase"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-currency-name">Name</Label>
            <Input
              id="new-currency-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Swiss Franc"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-currency-symbol">Symbol</Label>
            <Input
              id="new-currency-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="Fr."
            />
          </div>
          <Button type="button" variant="outline" onClick={addCurrency}>
            <Plus data-icon="inline-start" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
