import type { ContractAnalysis, ClientDocumentKind } from "@/lib/types";
import { nowIso } from "@/lib/ids";

/**
 * Reads key terms out of a contract's own text.
 *
 * This is pattern matching, not comprehension. It has no model behind it and
 * makes no network call — the deliberate trade for keeping an NDA on the device
 * (the alternative would have put an API key in the browser bundle and posted
 * the document to a third party). So it is built to fail loudly: anything it
 * cannot find is left undefined and named in `warnings`, and nothing it proposes
 * is written to a client record until the user accepts it.
 *
 * The patterns target the phrasing of Indian and US consultancy paper — "shall
 * remain in effect for", "within thirty (30) days of invoice", "governed by the
 * laws of". A contract worded some other way simply yields fewer terms; it never
 * yields wrong ones silently, because every hit is shown next to the field it
 * would fill.
 */

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";

/** Spelled-out numbers, covering the ones that show up in notice and payment terms. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, forty_five: 45,
  fifty: 50, sixty: 60, ninety: 90,
};

function parseCount(raw: string): number | undefined {
  const trimmed = raw.trim().toLowerCase();
  const digits = Number(trimmed.replace(/,/g, ""));
  if (Number.isFinite(digits) && digits > 0) return digits;
  return NUMBER_WORDS[trimmed.replace(/[\s-]+/g, "_")];
}

/**
 * Contracts write the same number twice — "thirty (30) days". The parenthesised
 * digits are the authoritative form, so prefer them and fall back to the word.
 */
const COUNT = String.raw`([0-9]{1,4}|[a-z]+(?:[\s-][a-z]+)?)\s*(?:\(\s*([0-9]{1,4})\s*\))?`;

function countFrom(match: RegExpMatchArray, wordIndex: number, digitIndex: number): number | undefined {
  const digits = match[digitIndex];
  if (digits) {
    const value = Number(digits);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return parseCount(match[wordIndex] ?? "");
}

export function analyseContractText(text: string, kind: ClientDocumentKind): ContractAnalysis {
  const analysis: ContractAnalysis = {
    extractedAt: nowIso(),
    textLength: text.length,
    parties: [],
    rates: [],
    warnings: [],
  };

  if (text.length === 0) {
    analysis.warnings.push("No readable text — nothing could be extracted.");
    return analysis;
  }

  const lower = text.toLowerCase();

  analysis.parties = findParties(text);
  analysis.effectiveDate = findDate(
    lower,
    // "as of" is last: it is the loosest cue, and contracts that spell out
    // "Effective Date" should win over one that merely says "as of".
    /(?:effective\s+(?:as\s+of\s+|date[:\s]+|from\s+)|commenc(?:es|ing)\s+on\s+|dated\s+(?:as\s+of\s+)?|\bas\s+of\s+(?:the\s+)?)/
  );
  analysis.endDate = findDate(
    lower,
    /(?:expir(?:es|ation|y)\s+(?:on\s+|date[:\s]+)?|terminat(?:es|ion)\s+on\s+|until\s+)/
  );
  analysis.noticePeriodDays = findDayCount(lower, /(?:notice\s+(?:period\s+)?of\s+|upon\s+|with\s+|giving\s+)/, /notice/);
  analysis.paymentTermsDays = findPaymentTerms(lower);
  analysis.confidentialityYears = findConfidentialityYears(lower);
  analysis.governingLaw = findGoverningLaw(text);
  analysis.rates = findRates(text);

  const missing: Array<[unknown, string]> = [
    [analysis.parties.length ? analysis.parties : undefined, "the parties"],
    [analysis.effectiveDate, "an effective date"],
    [analysis.paymentTermsDays, "payment terms"],
    [analysis.rates.length ? analysis.rates : undefined, "a rate or fee"],
    [analysis.governingLaw, "a governing-law clause"],
  ];
  if (kind === "nda") missing.push([analysis.confidentialityYears, "a confidentiality period"]);

  for (const [value, label] of missing) {
    if (value === undefined) analysis.warnings.push(`Could not find ${label}.`);
  }

  return analysis;
}

/**
 * Party names sit next to the definitions that introduce them — `Acme Inc.
 * ("Client")` — or after "between X and Y". Both forms are matched; anything
 * longer than a company name is dropped rather than shown as a party.
 */
function findParties(text: string): string[] {
  const found = new Set<string>();

  const roles =
    "Client|Company|Consultant|Contractor|Discloser|Disclosing Party|Recipient|Receiving Party|Service Provider|Supplier|Vendor|Customer";
  const defined = new RegExp(
    String.raw`([A-Z][A-Za-z0-9&.,'’\- ]{2,60}?)[\s,]*\(\s*(?:the\s+|hereinafter\s+(?:referred\s+to\s+as\s+)?(?:the\s+)?)?["'“‘]?(?:${roles})["'”’]?\s*\)`,
    "g"
  );
  for (const match of text.matchAll(defined)) {
    const name = cleanParty(match[1]);
    if (name) found.add(name);
  }

  const between = /\bbetween\s+([A-Z][A-Za-z0-9&.,'’\- ]{2,60}?)\s+and\s+([A-Z][A-Za-z0-9&.,'’\- ]{2,60}?)(?=[,.\n]|\s+\()/g;
  for (const match of text.matchAll(between)) {
    for (const raw of [match[1], match[2]]) {
      const name = cleanParty(raw);
      if (name) found.add(name);
    }
  }

  return [...found].slice(0, 6);
}

function cleanParty(raw: string): string | undefined {
  const name = raw.replace(/\s+/g, " ").replace(/[,\s]+$/, "").trim();
  if (name.length < 3 || name.length > 60) return undefined;
  // "This Agreement is made" has the shape of a name without being one.
  if (/^(this|that|the|an?|agreement|whereas|made)\b/i.test(name)) return undefined;
  return name;
}

const DATE_PATTERNS = [
  // 1 April 2026 / 1st day of April, 2026
  new RegExp(String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?(${MONTHS})\.?,?\s+(\d{4})`, "i"),
  // April 1, 2026
  new RegExp(String.raw`(${MONTHS})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`, "i"),
  // 2026-04-01
  /(\d{4})-(\d{2})-(\d{2})/,
  // 01/04/2026 — read day-first, the Indian and British convention this entity's paper uses.
  /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
];

const MONTH_INDEX = MONTHS.split("|");

/** Looks for a date in the ~120 characters after a cue phrase. */
function findDate(lower: string, cue: RegExp): string | undefined {
  const anchored = new RegExp(cue.source + String.raw`([\s\S]{0,120})`, "i");
  const match = lower.match(anchored);
  if (!match) return undefined;
  return parseDate(match[match.length - 1]);
}

export function parseDate(fragment: string): string | undefined {
  for (const [index, pattern] of DATE_PATTERNS.entries()) {
    const match = fragment.match(pattern);
    if (!match) continue;

    let year: number;
    let month: number;
    let day: number;

    if (index === 0) {
      day = Number(match[1]);
      month = MONTH_INDEX.indexOf(match[2].toLowerCase()) + 1;
      year = Number(match[3]);
    } else if (index === 1) {
      month = MONTH_INDEX.indexOf(match[1].toLowerCase()) + 1;
      day = Number(match[2]);
      year = Number(match[3]);
    } else if (index === 2) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
    }

    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) continue;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return undefined;
}

/** A day count inside a phrase, e.g. "sixty (60) days written notice". */
function findDayCount(lower: string, before: RegExp, near: RegExp): number | undefined {
  const pattern = new RegExp(
    before.source + COUNT + String.raw`\s*(?:calendar\s+|business\s+|working\s+)?days?`,
    "gi"
  );
  for (const match of lower.matchAll(pattern)) {
    const at = match.index ?? 0;
    const window = lower.slice(Math.max(0, at - 80), at + match[0].length + 80);
    if (!near.test(window)) continue;
    const days = countFrom(match, 1, 2);
    if (days && days <= 365) return days;
  }
  return undefined;
}

function findPaymentTerms(lower: string): number | undefined {
  const patterns = [
    new RegExp(String.raw`net\s+` + COUNT, "gi"),
    new RegExp(
      String.raw`within\s+` +
        COUNT +
        String.raw`\s*(?:calendar\s+|business\s+|working\s+)?days?\s+(?:of|from|after|following)\s+(?:the\s+)?(?:date\s+of\s+)?(?:receipt\s+of\s+)?(?:the\s+|an\s+)?invoice`,
      "gi"
    ),
    new RegExp(String.raw`payment\s+terms?[:\s]+(?:net\s+)?` + COUNT + String.raw`\s*days?`, "gi"),
  ];

  for (const pattern of patterns) {
    for (const match of lower.matchAll(pattern)) {
      const days = countFrom(match, 1, 2);
      // "net 90" is plausible; "net 2026" is a year that wandered in.
      if (days && days <= 365) return days;
    }
  }
  return undefined;
}

function findConfidentialityYears(lower: string): number | undefined {
  const pattern = new RegExp(
    String.raw`(?:confidential(?:ity)?|obligations?|surviv\w*|remain\s+in\s+(?:full\s+force|effect))[\s\S]{0,120}?(?:period\s+of\s+|for\s+)?` +
      COUNT +
      String.raw`\s*\(?\s*(years?|months?)`,
    "gi"
  );
  for (const match of lower.matchAll(pattern)) {
    const value = countFrom(match, 1, 2);
    if (!value) continue;
    const years = match[3].startsWith("month") ? value / 12 : value;
    if (years > 0 && years <= 99) return Math.round(years * 10) / 10;
  }
  return undefined;
}

function findGoverningLaw(text: string): string | undefined {
  const match = text.match(
    /govern(?:ed|ing)\s+(?:by|law)[^.\n]{0,60}?laws?\s+of\s+(?:the\s+)?([A-Z][A-Za-z .'’-]{2,60}?)(?=[,.\n]|\s+(?:and|without|excluding))/
  );
  if (match) return tidy(match[1]);

  const fallback = text.match(/\blaws?\s+of\s+(?:the\s+)?((?:State\s+of\s+)?[A-Z][A-Za-z .'’-]{2,50}?)(?=[,.\n])/);
  return fallback ? tidy(fallback[1]) : undefined;
}

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  $: "USD",
  "₹": "INR",
  "€": "EUR",
  "£": "GBP",
};

const UNIT_WORDS: Record<string, NonNullable<ContractAnalysis["rates"][number]["unit"]>> = {
  hour: "hour",
  hourly: "hour",
  hr: "hour",
  day: "day",
  daily: "day",
  diem: "day",
  month: "month",
  monthly: "month",
  year: "year",
  annum: "year",
  annually: "year",
  yearly: "year",
};

const RATE_CONTEXT = /\b(rate|fee|fees|charge[sd]?|compensation|remuneration|retainer|payable|invoiced?|consideration|cost)\b/i;

/**
 * Money amounts stated near rate or fee language, with the unit if one follows.
 *
 * Deliberately narrow: matching every number in the document would bury the one
 * figure that matters under section numbers and dates.
 */
function findRates(text: string): ContractAnalysis["rates"] {
  const pattern =
    /(?:^|[\s(])(?:(USD|INR|EUR|GBP|SGD|AED|Rs\.?)\s*|([$₹€£]))\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s*(?:per|\/|an?)\s*([A-Za-z]+))?/g;
  const rates: ContractAnalysis["rates"] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(pattern)) {
    const amount = Number(match[3].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const at = match.index ?? 0;
    const context = text.slice(Math.max(0, at - 100), at + match[0].length + 60);
    if (!RATE_CONTEXT.test(context)) continue;

    const code = match[1] ? (/^rs/i.test(match[1]) ? "INR" : match[1].toUpperCase()) : undefined;
    const currency = code ?? (match[2] ? CURRENCY_BY_SYMBOL[match[2]] : undefined);
    const unit = match[4] ? UNIT_WORDS[match[4].toLowerCase().replace(/s$/, "")] : undefined;

    const key = `${currency ?? ""}|${amount}|${unit ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rates.push({ label: labelFor(context), amount, currency, unit: unit ?? "flat" });
    if (rates.length >= 6) break;
  }

  return rates;
}

/** The clause word the amount sat under, so a list of figures reads as something. */
function labelFor(context: string): string {
  const match = context.match(
    /\b(hourly\s+rate|daily\s+rate|monthly\s+(?:fee|retainer)|retainer|professional\s+fees?|service\s+fees?|consulting\s+fees?|fees?|rate|compensation|charges?)\b/i
  );
  if (!match) return "Amount";
  // Clause headings are shouted ("3. FEES."); a label reads better in prose case.
  const label = tidy(match[1]);
  return label === label.toUpperCase() ? label.charAt(0) + label.slice(1).toLowerCase() : label;
}
