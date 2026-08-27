import type { EntityProfile, Invoice } from "@/lib/types";
import { BASE_PATH } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { unconfirmedProfileFields } from "@/lib/entity-profile";

/**
 * Client-side invoice PDF generation (module 1, US-2).
 *
 * @react-pdf/renderer and the document template are pulled in by dynamic import
 * at click time. Keeping them out of the static module graph means they never run
 * during the export prerender and never weigh down the initial load of a PWA
 * that is mostly used on a phone.
 */

export function invoicePdfFileName(invoice: Invoice): string {
  // Serials contain slashes; a filename cannot.
  const safeSerial = invoice.serialNumber.replace(/[\\/]/g, "-");
  const safeClient = invoice.clientSnapshot.name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  return `${safeSerial}-${safeClient}.pdf`;
}

/** Fetches the crest as a data URI. Returns undefined rather than throwing — a missing logo must not block an invoice. */
async function loadLogoDataUri(): Promise<string | undefined> {
  try {
    const response = await fetch(`${BASE_PATH}/logo.png`);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/**
 * Generation is never refused for an incomplete profile.
 *
 * It used to be: an unfilled particular threw and no PDF came out. That traded a
 * document clearly marked as unfinished for no document at all, which is the
 * worse of the two when the profile is filled in over weeks and a draft still
 * needs to go out for review. The document now renders whatever the profile
 * holds — a blank particular prints as an em dash, a placeholder prints as
 * "TO BE UPDATED" — and `unconfirmedProfileFields` drives the reminder in the UI
 * that says which ones those are.
 */
export async function buildInvoicePdfBlob(invoice: Invoice, profile: EntityProfile): Promise<Blob> {
  const [{ pdf }, { InvoicePdfDocument }, logoDataUri] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/components/invoices/invoice-pdf-document"),
    loadLogoDataUri(),
  ]);

  return pdf(InvoicePdfDocument({ invoice, profile, logoDataUri })).toBlob();
}

/**
 * Generates and saves the PDF, then records the download in the audit trail —
 * required by module 1 US-2, so the log is written here rather than left to each
 * call site to remember.
 */
export async function downloadInvoicePdf(invoice: Invoice, profile: EntityProfile): Promise<void> {
  const blob = await buildInvoicePdfBlob(invoice, profile);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = invoicePdfFileName(invoice);
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }

  // Which particulars the document went out without is the part worth keeping.
  // Nothing blocks the download, so the audit trail is the only place that stays
  // true about what a given PDF actually carried.
  const unconfirmed = unconfirmedProfileFields(profile);
  await recordAudit({
    actionType: "invoice_pdf_downloaded",
    entityType: "invoice",
    entityId: invoice.id,
    summary:
      unconfirmed.length > 0
        ? `${invoice.serialNumber} PDF downloaded with unconfirmed particulars: ${unconfirmed.join(", ")}`
        : `${invoice.serialNumber} PDF downloaded`,
    isManualOverride: unconfirmed.length > 0,
  });
}
