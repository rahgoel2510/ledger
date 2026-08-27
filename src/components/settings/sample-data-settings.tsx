"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadSampleData } from "@/lib/sample-data";

/**
 * Fills a fresh database with specimen particulars so every screen can be
 * exercised without typing a profile out first.
 *
 * Development only — `next build` sets NODE_ENV to production, so this never
 * reaches the deployed bundle. A "fill my books with fabricated numbers" button
 * on a live bookkeeping app is a hazard, not a convenience.
 */
export function SampleDataSettings() {
  const [busy, setBusy] = useState(false);

  if (process.env.NODE_ENV === "production") return null;

  async function onLoad() {
    setBusy(true);
    try {
      const result = await loadSampleData();
      const added = result.clientsAdded.length;
      toast.success(
        added > 0
          ? `Sample profile saved, ${added} client${added === 1 ? "" : "s"} added.`
          : "Sample profile saved. The sample clients were already present."
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load sample data.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4" />
          Sample data
        </CardTitle>
        <CardDescription>
          Fills the entity profile and adds two clients — one US export in USD, one domestic Indian
          supply in INR — so invoices and PDFs can be produced immediately. The particulars are
          structurally valid and entirely fictitious; an invoice raised on them is a specimen.
          Refused once any invoice exists, since those were issued under the real profile. Shown in
          development only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={onLoad} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
          Load sample data
        </Button>
      </CardContent>
    </Card>
  );
}
