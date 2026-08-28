"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClientDocument, ClientDocumentKind, ContractAnalysis } from "@/lib/types";
import { DOCUMENT_KIND_LABELS, downloadClientDocument } from "@/lib/client-documents";
import { extractDocumentText, formatBytes, MAX_DOCUMENT_BYTES } from "@/lib/contract-text";
import { analyseContractText } from "@/lib/contract-analysis";

/**
 * Attach an NDA or contract and read its terms.
 *
 * The panel is explicit that the reading is done here, on this device, by pattern
 * matching — no model, no upload. That is not modesty: it sets the expectation
 * that a term it missed is normal, and that every figure it does propose has to
 * be checked against the paper before it is accepted.
 */

export interface StagedDocument {
  file: File;
  kind: ClientDocumentKind;
  analysis?: ContractAnalysis;
}

export function ContractUploadPanel({
  staged,
  onStagedChange,
  existing,
  onDelete,
  onApply,
}: {
  staged: StagedDocument[];
  onStagedChange: (documents: StagedDocument[]) => void;
  /** Already saved against this client — empty while creating a new one. */
  existing: ClientDocument[];
  onDelete?: (id: string) => void;
  /** Called when the user accepts a proposed term. */
  onApply?: (analysis: ContractAnalysis) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ClientDocumentKind>("nda");
  const [busy, setBusy] = useState(false);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared immediately so picking the same file twice still fires a change.
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    try {
      const outcome = await extractDocumentText(file);

      if (outcome.status === "ok") {
        const analysis = analyseContractText(outcome.text, kind);
        onStagedChange([...staged, { file, kind, analysis }]);
        toast.success(
          analysis.warnings.length === 0
            ? "Read the contract and found every term it looks for."
            : "Read the contract — some terms could not be found."
        );
        return;
      }

      // Unreadable is not a reason to refuse the file: the signed document still
      // has to live somewhere, and the terms can be typed in.
      onStagedChange([...staged, { file, kind }]);
      toast.message("Attached without analysis", { description: outcome.reason });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label className="mb-2 block text-sm font-medium" htmlFor="document-kind">
            Document type
          </label>
          <Select value={kind} onValueChange={(value) => setKind(value as ClientDocumentKind)}>
            <SelectTrigger id="document-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DOCUMENT_KIND_LABELS) as ClientDocumentKind[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {DOCUMENT_KIND_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          {busy ? "Reading…" : "Attach document"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="sr-only"
          aria-label="Contract or NDA"
          onChange={onPick}
        />
      </div>

      <p className="text-muted-foreground text-xs">
        PDF, DOCX, or plain text up to {formatBytes(MAX_DOCUMENT_BYTES)}. The file is read on this
        device and stored here — nothing is uploaded, and no AI service sees it.
      </p>

      {staged.map((document, index) => (
        <StagedCard
          key={`${document.file.name}-${index}`}
          document={document}
          onApply={onApply}
          onRemove={() => onStagedChange(staged.filter((_, i) => i !== index))}
        />
      ))}

      {existing.map((document) => (
        <div key={document.id} className="rounded-lg border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="text-muted-foreground size-4 shrink-0" />
                <button
                  type="button"
                  className="truncate text-sm font-medium underline-offset-2 hover:underline"
                  onClick={() => downloadClientDocument(document)}
                >
                  {document.fileName}
                </button>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {DOCUMENT_KIND_LABELS[document.kind]} · {formatBytes(document.size)} · attached{" "}
                {document.uploadedAt.slice(0, 10)}
              </p>
            </div>
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${document.fileName}`}
                onClick={() => onDelete(document.id)}
              >
                <Trash2 className="text-destructive size-4" />
              </Button>
            )}
          </div>
          {document.analysis && <AnalysisSummary analysis={document.analysis} onApply={onApply} />}
        </div>
      ))}
    </div>
  );
}

function StagedCard({
  document,
  onRemove,
  onApply,
}: {
  document: StagedDocument;
  onRemove: () => void;
  onApply?: (analysis: ContractAnalysis) => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate text-sm font-medium">{document.file.name}</span>
            <Badge variant="secondary">Not saved yet</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {DOCUMENT_KIND_LABELS[document.kind]} · {formatBytes(document.file.size)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${document.file.name}`}
          onClick={onRemove}
        >
          <Trash2 className="text-destructive size-4" />
        </Button>
      </div>
      {document.analysis && <AnalysisSummary analysis={document.analysis} onApply={onApply} />}
    </div>
  );
}

function AnalysisSummary({
  analysis,
  onApply,
}: {
  analysis: ContractAnalysis;
  onApply?: (analysis: ContractAnalysis) => void;
}) {
  const rows: Array<[string, string]> = [];
  if (analysis.parties.length) rows.push(["Parties", analysis.parties.join(" · ")]);
  if (analysis.effectiveDate) rows.push(["Effective from", analysis.effectiveDate]);
  if (analysis.endDate) rows.push(["Ends", analysis.endDate]);
  if (analysis.paymentTermsDays !== undefined) rows.push(["Payment terms", `${analysis.paymentTermsDays} days`]);
  if (analysis.noticePeriodDays !== undefined) rows.push(["Notice period", `${analysis.noticePeriodDays} days`]);
  if (analysis.confidentialityYears !== undefined) {
    rows.push(["Confidentiality", `${analysis.confidentialityYears} years`]);
  }
  if (analysis.governingLaw) rows.push(["Governing law", analysis.governingLaw]);
  for (const rate of analysis.rates) {
    const per = rate.unit && rate.unit !== "flat" ? ` per ${rate.unit}` : "";
    rows.push([rate.label, `${rate.currency ?? ""} ${rate.amount.toLocaleString("en-IN")}${per}`.trim()]);
  }

  const canPrefill = analysis.rates.length > 0 || analysis.effectiveDate !== undefined;

  return (
    <div className="mt-3 border-t pt-3">
      {analysis.textLength === 0 ? (
        <p className="text-muted-foreground text-xs">
          No text could be read from this file — it is most likely a scan. Attached as-is.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <Sparkles className="text-muted-foreground size-3.5" />
            <span className="text-xs font-medium">Terms found in the document</span>
          </div>

          {rows.length > 0 ? (
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
              {rows.map(([label, value]) => (
                <div key={`${label}-${value}`} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">Nothing recognisable was found.</p>
          )}

          {analysis.warnings.length > 0 && (
            <ul className="text-muted-foreground mt-2 list-disc space-y-0.5 pl-4 text-xs">
              {analysis.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {onApply && canPrefill && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => onApply(analysis)}
            >
              Use these terms
            </Button>
          )}

          <p className="text-muted-foreground mt-2 text-xs">
            Read by pattern matching on this device, not by an AI — check every figure against the
            document before relying on it.
          </p>
        </>
      )}
    </div>
  );
}
