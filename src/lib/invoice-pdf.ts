import type { EntityProfile, Invoice } from "@/lib/types";
import { BASE_PATH } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { missingProfileFields } from "@/lib/entity-profile";

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

export async function buildInvoicePdfBlob(invoice: Invoice, profile: EntityProfile): Promise<Blob> {
  const missing = missingProfileFields(profile);
  if (missing.length > 0) {
    throw new Error(
      `Complete these in Settings before issuing an invoice: ${missing.join(", ")}.`
    );
  }

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

  await recordAudit({
    actionType: "invoice_pdf_downloaded",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `${invoice.serialNumber} PDF downloaded`,
  });
}
