import zlib from "node:zlib";
import type { Page } from "@playwright/test";

import {
  test,
  expect,
  readTable,
  addClient,
  addInvoice,
  completeEntityProfile,
  openInvoice,
  COMPLETE_PROFILE,
  type AuditEntryShape,
} from "./fixtures";

/**
 * Phase 1 — invoice PDF generation (module 1, US-2).
 *
 * The PDF is the one artefact that leaves this app and lands in front of a
 * client and, eventually, a tax officer. These tests extract the text back out
 * of the generated file and assert the mandatory content is present verbatim.
 */

const IGST_DISCLAIMER =
  "SUPPLY MEANT FOR EXPORT OF SERVICES UNDER LETTER OF UNDERTAKING (LUT) WITHOUT PAYMENT OF INTEGRATED TAX (IGST). REMITTANCE TO BE CREDITED IN FOREIGN CURRENCY TO RAHUL GOEL HUF BANK ACCOUNT.";

/**
 * Pulls readable text out of a generated PDF.
 *
 * @react-pdf writes one `TJ` per laid-out line, with the glyphs as hex strings
 * split around kerning adjustments — e.g. `[<54> 120 <41> 0 <20494e56>] TJ` is
 * one line reading " INV" after "TA". So the pieces inside one array join with
 * nothing (they are a single line) while separate operators join with a space
 * (they are separate lines). Getting that backwards would glue wrapped words
 * together and fail a verbatim assertion for the wrong reason.
 *
 * The fonts in use are the standard single-byte ones, so a hex pair is one
 * character. Cheaper than a PDF parser dependency for a few content checks.
 */
function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const lines: string[] = [];

  const decodeLiteral = (value: string) =>
    value
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));

  const decodeHex = (value: string) => {
    const digits = value.replace(/[^0-9a-fA-F]/g, "");
    let out = "";
    for (let i = 0; i + 1 < digits.length; i += 2) {
      out += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
    }
    return out;
  };

  const streamPattern = /stream\r?\n?([\s\S]*?)endstream/g;
  const operatorPattern = /\[([^\]]*)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*Tj|<([0-9a-fA-F\s]*)>\s*Tj/g;
  const piecePattern = /\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]*)>/g;

  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw)) !== null) {
    let content = match[1];
    try {
      content = zlib.inflateSync(Buffer.from(content, "latin1")).toString("latin1");
    } catch {
      // Not a compressed stream (an image, say) — fall through to the raw bytes.
    }

    for (const op of content.matchAll(operatorPattern)) {
      if (op[1] !== undefined) {
        let line = "";
        for (const piece of op[1].matchAll(piecePattern)) {
          line += piece[1] !== undefined ? decodeLiteral(piece[1]) : decodeHex(piece[2]);
        }
        lines.push(line);
      } else if (op[2] !== undefined) {
        lines.push(decodeLiteral(op[2]));
      } else {
        lines.push(decodeHex(op[3]));
      }
    }
  }

  return lines.join(" ");
}

/** Collapses whitespace so an assertion isn't sensitive to where a line wrapped. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function downloadPdf(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test.describe("invoice PDF", () => {
  test.beforeEach(async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, {
      name: "Acme Inc",
      country: "United States",
      currency: "USD",
      taxId: "EIN 12-3456789",
      billingAddress: "500 Market St\nSan Francisco, CA 94105",
    });
  });

  test("generates a valid PDF without contacting any other origin", async ({ page, baseURL }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.25",
      quantity: "10",
      unitPrice: "150",
    });

    await openInvoice(page, serial);

    // Module 1 US-2 is about generation being client-side. Asserting "no
    // third-party request" is the real property; flipping the context offline
    // would only prove that the dev server lazily serves its own JS chunks over
    // HTTP, which the service worker caches in production anyway.
    const foreign: string[] = [];
    const origin = new URL(baseURL!).origin;
    // `blob:` and `data:` never leave the browser — the generated PDF is handed
    // to the download as a blob URL, so it shows up here as a "request".
    const isLocal = (url: string) =>
      url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:");
    page.on("request", (request) => {
      if (!isLocal(request.url())) foreign.push(request.url());
    });

    const pdf = await downloadPdf(page);

    expect(foreign).toEqual([]);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  test("carries the IGST export disclaimer verbatim", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });
    await openInvoice(page, serial);

    const text = flatten(extractPdfText(await downloadPdf(page)));

    // Verbatim, exactly as specified in CLAUDE.md — no rewording or re-casing.
    expect(text).toContain(IGST_DISCLAIMER);
  });

  test("carries the full bank wire block", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });
    await openInvoice(page, serial);

    const text = flatten(extractPdfText(await downloadPdf(page)));

    // An overseas client cannot pay without all four of these.
    expect(text).toContain(COMPLETE_PROFILE.bankName);
    expect(text).toContain(COMPLETE_PROFILE.bankAccountNumber);
    expect(text).toContain(COMPLETE_PROFILE.bankIfsc);
    expect(text).toContain(COMPLETE_PROFILE.bankSwift);
    expect(text).toContain("SWIFT / BIC CODE");
  });

  test("shows the serial, client, zero-rated IGST line, and frozen FX rate", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.2500",
      description: "Platform engineering",
      quantity: "10",
      unitPrice: "150",
    });
    await openInvoice(page, serial);

    const text = flatten(extractPdfText(await downloadPdf(page)));

    expect(text).toContain("TAX INVOICE");
    expect(text).toContain(serial);
    expect(text).toContain("Acme Inc");
    expect(text).toContain("San Francisco");
    expect(text).toContain("EIN 12-3456789");
    expect(text).toContain("Platform engineering");
    expect(text).toContain(COMPLETE_PROFILE.gstin);

    // IGST on export of services under LUT is always zero.
    expect(text).toContain("IGST @ 0%");
    expect(text).toContain("Export of Services");

    // 10 x 150 = 1,500 USD; the frozen rate and INR equivalent both appear.
    expect(text).toContain("1,500.00");
    expect(text).toContain("83.2500");
    expect(text).toContain("1,24,875.00");
  });

  test("records every download in the audit trail", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });
    await openInvoice(page, serial);

    await downloadPdf(page);
    await expect(page.getByText("PDF downloaded.")).toBeVisible();
    await downloadPdf(page);

    const audit = await readTable<AuditEntryShape>(page, "auditLog");
    const downloads = audit.filter((entry) => entry.actionType === "invoice_pdf_downloaded");

    // Each download is its own entry, timestamped — module 1 US-2.
    expect(downloads).toHaveLength(2);
    expect(downloads[0].summary).toContain(serial);
  });

  test("names the file after the serial and client", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });
    await openInvoice(page, serial);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    const download = await downloadPromise;

    // Serials contain slashes, which a filename cannot.
    expect(download.suggestedFilename()).toBe(`${serial.replace(/\//g, "-")}-Acme-Inc.pdf`);
  });

  test("refuses to generate while a mandatory bank field is missing", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });

    // The settings form already refuses to save a blank SWIFT code, so clear it
    // at the store instead — the point is that the PDF path is gated too, not
    // only the form that feeds it.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("vrikshafx");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("entityProfile", "readwrite");
            const store = tx.objectStore("entityProfile");
            const get = store.get("default");
            get.onsuccess = () => store.put({ ...get.result, bankSwift: "" });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        })
    );

    await openInvoice(page, serial);
    await page.getByRole("button", { name: "Download PDF" }).click();

    await expect(page.getByText(/Complete these in Settings/)).toBeVisible();
    await expect(page.getByText(/SWIFT\/BIC code/)).toBeVisible();
  });
});
