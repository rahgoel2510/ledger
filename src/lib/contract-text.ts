import { unzipSync, strFromU8 } from "fflate";

/**
 * Pulls plain text out of an uploaded contract, entirely in the browser.
 *
 * Nothing here uploads the file or calls a model — the document is an NDA, and
 * the whole point of the chosen approach is that it never leaves the machine
 * (see CLAUDE.md and the analysis engine in `contract-analysis.ts`). The cost of
 * that is honest: a scanned contract is a picture of words, and there is no OCR
 * here, so it yields nothing and says so rather than pretending.
 */

/** Files above this are rejected before reading. They live in IndexedDB and travel in the JSON backup. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export type ExtractionOutcome =
  | { status: "ok"; text: string }
  | { status: "empty"; reason: string }
  | { status: "unsupported"; reason: string }
  | { status: "failed"; reason: string };

const PDF_TYPES = ["application/pdf"];
const DOCX_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function isSupportedDocument(file: File): boolean {
  return kindOf(file) !== "other";
}

function kindOf(file: File): "pdf" | "docx" | "text" | "other" {
  const name = file.name.toLowerCase();
  if (PDF_TYPES.includes(file.type) || name.endsWith(".pdf")) return "pdf";
  if (DOCX_TYPES.includes(file.type) || name.endsWith(".docx")) return "docx";
  if (file.type.startsWith("text/") || /\.(txt|md|rtf)$/.test(name)) return "text";
  return "other";
}

export async function extractDocumentText(file: File): Promise<ExtractionOutcome> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      status: "unsupported",
      reason: `That file is ${formatBytes(file.size)}. Keep documents under ${formatBytes(MAX_DOCUMENT_BYTES)} — they are stored on this device and included in every backup.`,
    };
  }

  try {
    switch (kindOf(file)) {
      case "pdf":
        return finish(await extractPdf(await file.arrayBuffer()), "This PDF has no text layer — it is most likely a scan. Attach it anyway; the terms just have to be typed in.");
      case "docx":
        return finish(extractDocx(new Uint8Array(await file.arrayBuffer())), "This document appears to be empty.");
      case "text":
        return finish(await file.text(), "This document appears to be empty.");
      default:
        return {
          status: "unsupported",
          reason: "Only PDF, DOCX, and plain-text documents can be read. Other files can still be attached, just not analysed.",
        };
    }
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "The file could not be read.",
    };
  }
}

function finish(text: string, emptyReason: string): ExtractionOutcome {
  const cleaned = normalizeWhitespace(text);
  return cleaned.length === 0 ? { status: "empty", reason: emptyReason } : { status: "ok", text: cleaned };
}

/**
 * Collapses runs of spaces but keeps line breaks: clause headings and party
 * blocks are laid out by line, and the term patterns lean on that.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0\u2007\u202f]/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  // Dynamic: pdf.js is ~1MB and only ever needed on the client-onboarding path,
  // so it must not sit in the shared bundle every page pays for.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        // pdf.js reports where a line ended; without honouring it every page
        // becomes one run-on line and the line-anchored patterns all miss.
        text += item.hasEOL ? "\n" : "";
      }
      pages.push(text);
      page.cleanup();
    }
  } finally {
    // Tears down the worker too — without this every uploaded contract leaks one.
    await task.destroy();
  }

  return pages.join("\n\n");
}

function extractDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("That .docx has no document body — it may be corrupt.");

  return (
    strFromU8(xml)
      // Paragraph and line breaks first, or stripping tags would run every
      // clause of the contract together.
      .replace(/<w:p\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br\b[^>]*\/?>/g, "\n")
      .replace(/<w:tab\b[^>]*\/?>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
