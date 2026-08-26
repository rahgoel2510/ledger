# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

`docs/vision.md` is the authoritative requirements doc — read it for full detail; this file distills what a coding session needs without re-deriving it. Per-module specs and acceptance criteria live in `docs/modules/`.

**Shipped:** module 0 (PWA shell/offline), module 1 (invoicing + PDF), module 5 (client directory), settings (entity profile, currencies, local backup/restore), live dashboard metrics, and the GitHub Pages deploy workflow.

**Not built yet:** modules 2 (GCS sync), 3 (remittances/forex), 4 (ledger reports), 6 (AR aging), 7 (expenses), 8 (audit-log view). The pages for these render `PageStub`. The domain layer they need already exists and is wired — see "Shared domain layer" below — so these are UI-and-queries work, not foundations work.

Commands: `npm run dev`, `npm run build` (static export to `out/`), `npm run lint`, `npx tsc --noEmit`, `npm run test:e2e` (Playwright; `test:e2e:ui` to debug, `test:e2e:report` for the last HTML report).

**Tests are E2E only, in `e2e/`** — one spec per phase of work, run against `next dev` on port 3210 (the config starts it). `e2e/fixtures.ts` holds the shared helpers; read its header before adding a spec. Two things about it are load-bearing:
- Assertions read IndexedDB directly via `readTable`, because the ledger and audit trail have no UI yet — that is the only way their rules stay covered until modules 4 and 8 ship.
- `readTable` checks `indexedDB.databases()` before opening. A bare `indexedDB.open(name)` *creates* an empty database, which makes Dexie skip `populate` and never seed. Never remove that check.

- An auto-fixture stubs the IFSC directory (`IFSC_DIRECTORY` in `fixtures.ts`). `completeEntityProfile` runs in nearly every spec and types an IFSC, so without it the suite would call a third-party service dozens of times per run. Tests wanting an outage or a 404 register their own `page.route` after it.

Tests run serially (`workers: 1`): they share one origin's IndexedDB, and Playwright's per-test browser context is what isolates them. The `mobile-chromium` project runs only `mobile.spec.ts`; `desktop-chromium` ignores it.

**One-time manual step:** GitHub Pages must be set to "GitHub Actions" as its source under the repo's Settings → Pages before `.github/workflows/deploy.yml` can publish.

**No subagents for this project.** Do the work directly (with skills for repeatable procedures like scaffolding/deploying) rather than spawning `.claude/agents`. This is a single-tenant personal app, not something that benefits from splitting into parallel agent-owned modules.

## Project overview

**VrikshaFX** — a bookkeeping PWA for **Rahul Goel HUF** (a Hindu Undivided Family tax entity) to issue foreign-currency invoices, generate compliant PDF invoices, track remittances, and compute realized forex gains/losses for HUF tax filings.

- Base currency INR; secondary currencies USD, EUR by default, expandable to GBP, SGD, AED, etc. — currency list must be user-configurable, not hardcoded.
- Installable PWA, responsive for desktop and mobile.

## Architecture & tech stack

- **Frontend:** Next.js (App Router, TypeScript), static export (`output: 'export'`) — deployed to **GitHub Pages**. No Node server, API routes, or SSR at runtime; anything server-shaped won't work in production. (Open to a different framework if it's clearly better suited to static-export + PWA, but default to Next.js since the project is already scoped around it — don't switch without a concrete reason.)
- **PWA:** web app manifest + service worker for installability and offline app-shell caching. Must work with static export (no framework feature that assumes a server).
- **Styling/UI:** Tailwind CSS + Shadcn UI, `lucide-react` icons.
- **Local persistence:** IndexedDB (via `dexie.js`) — the app's source of truth; must be fully usable offline / with cloud sync disabled.
- **Cloud storage:** Google Cloud Storage, used entirely within the **free tier (~5GB, $0 billing)** — see Storage rules below. Client-side only; no backend service holds credentials.
- **PDF generation:** `@react-pdf/renderer` or `jspdf` + `html2canvas`, entirely client-side.
- **Deployment:** GitHub Actions workflow builds the static export and publishes to GitHub Pages on push.

### GitHub Pages export config

`next.config.js`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  basePath: process.env.NODE_ENV === 'production' ? '/vrikshafx' : '',
};
module.exports = nextConfig;
```

## Storage rules (Google Cloud Storage, $0 tier)

- Uploads happen **client-side**, authenticated via OAuth2 (user's own Google account, consent-based) — never embed a GCP service-account key in the frontend bundle; there's no backend to keep it secret.
- Stay inside the always-free tier: keep the bucket in a `US-*` free-tier-eligible region/class, avoid unnecessary re-uploads/re-downloads (egress and Class A/B operations both have free-tier caps), and batch or skip uploads a user hasn't asked for rather than syncing eagerly.
- Folder convention: `Rahul Goel HUF/Invoices/FY26-27/` (financial-year-scoped, matching invoice serial numbering).
- Cloud sync is a **backup**, not a dependency — IndexedDB is the source of truth; every feature must degrade gracefully (and stay fully functional) if the user is offline, unauthenticated, or the free tier is exhausted.

## Tax scope boundary (explicit decision — do not expand without asking)

This app does **record-keeping compliance only** — clean books and CA-ready reports. It does **not** compute tax liability.

In scope:
1. Double-entry/clean ledger tracking for Rahul Goel HUF.
2. Invoicing with zero-rated IGST export disclaimers, and automated realized forex gain/loss.
3. Structured P&L, expense categorization, and audit logs formatted for the CA to file ITR-2/ITR-3 directly.

Explicitly out of scope — never build these without the user re-opening this decision:
- Income tax liability calculators, slab-rate processors, or HUF tax computation.
- Automated advance tax calculation/reminders.
- Any feature that computes what tax is owed rather than what happened financially.

Tax computation is the CA's job; this app's job is to hand them accurate, structured numbers.

## Shared domain layer (`src/lib/`)

Every module goes through these rather than touching Dexie directly. They encode rules that must not be re-implemented per page:

- `db.ts` — Dexie schema, currently at **version 2**. Adding a table or field means a new `version(n).stores(...).upgrade(...)`; `populate` only fires for a brand-new database, so an upgrade path must seed anything new itself.
- `types.ts` — all domain types. Note `StoredInvoiceStatus` (draft/sent/paid) vs `InvoiceStatus` (adds "overdue"): overdue is derived on read, never stored.
- `entity-profile.ts` — the HUF's own particulars (bank wire block, GSTIN, LUT), a singleton row. `missingProfileFields()` gates PDF generation; invoicing UI surfaces the gaps rather than rendering blanks. **Every field on the Settings form is optional to save** — the profile is filled in over several sittings, so nothing there blocks a save. Compliance is enforced at the PDF instead, and Settings shows the same gap list as a banner. "Optional" still means validated: a malformed value present in a field is rejected (the form carries `noValidate`, so zod's messages are the only ones — the browser's native `type="email"` check would otherwise block submit before the resolver runs).
- `ifsc.ts` — IFSC → bank/branch lookup against `ifsc.razorpay.com` (public, keyless). The **only** outbound call the app makes; it sends a branch code and nothing else. Returns a result union rather than throwing, because offline/404/outage all end the same way — the user types the branch in. Results cache to localStorage, deliberately not Dexie: public reference data about someone else's bank does not belong in the books or the backup file.
- `serial.ts` — invoice serial allocation from a per-FY counter row, **not** `max(sequence)+1`. A deleted invoice's number is never reissued; gaps are the correct outcome.
- `ledger.ts` — the double-entry posting engine. Its header comment is the authoritative statement of the posting rules; `assertBalanced` refuses to write an unbalanced set. Corrections are reversing entries (`reverseSource`), never edits.
- `forex.ts` — the realized gain/loss formula. `realizedForexGainLoss()` matches CLAUDE.md verbatim (charges folded in); `pureForexVariance()` is the charges-excluded figure the ledger posts, so the P&L can show bank charges on their own line. The two net to the same total.
- `invoices.ts` / `clients.ts` — create/update/delete flows that post to the ledger and write the audit entry in one transaction. Never write these tables directly.
- `audit.ts` — append-only trail. `isManualOverride: true` marks a state a human forced against what the data implies.
- `backup.ts` — whole-database JSON export/import. This is the real disaster-recovery path (GCS covers PDFs only); import replaces rather than merges.
- `form-schema.ts` — typed zod number fields for react-hook-form. Use these instead of `z.coerce.number()`, which erases the form's input types.
- `igst.ts` — the mandatory export disclaimer, defined once so there is only one copy to get wrong.

Forms use react-hook-form + zod. `src/components/ui/form.tsx` is hand-written — the `radix-nova` shadcn style does not ship a `form` component, so `npx shadcn add form` is a no-op here.

## Domain rules (non-obvious — don't re-derive these)

Tax/legal requirements specific to this entity's export-of-services filing:

- **Zero-rated IGST:** invoices are for export of services under a Letter of Undertaking (LUT), IGST Act Section 16 — IGST is always 0%, and every invoice PDF must carry this exact disclaimer verbatim:
  > "SUPPLY MEANT FOR EXPORT OF SERVICES UNDER LETTER OF UNDERTAKING (LUT) WITHOUT PAYMENT OF INTEGRATED TAX (IGST). REMITTANCE TO BE CREDITED IN FOREIGN CURRENCY TO RAHUL GOEL HUF BANK ACCOUNT."
- Invoice PDFs must show HUF Bank Name, Account Number, IFSC, and SWIFT/BIC for international wire transfers.
- Serial numbers follow `RGHUF/INV/{FY}/{seq}` (e.g. `RGHUF/INV/26-27/001`) — financial-year-based, auto-incrementing, customizable structure.
- **Realized forex gain/loss formula** — the core calculation the reports module is built around:
  ```
  Realized Forex Gain/Loss = INR Credited − (FCY Received × Invoice Date FX Rate) − Bank Charges
  ```
  Uses the FX rate captured at **invoice date**, not the remittance-date rate or a freshly re-fetched one — persist the invoice-date rate at invoice creation time and reuse it here, don't recompute.
- Each remittance also records an FIRC (Foreign Inward Remittance Certificate) reference — required for RBI/bank compliance, not optional metadata.
- AR aging buckets: 0–30, 31–60, 61–90, 90+ days overdue, computed from invoice due date.

## Functional modules (from `docs/vision.md`)

1. **Invoicing** — serial numbering, foreign-currency invoices, client-side A4 PDF generation, IGST disclaimer + bank wire details.
2. **Cloud storage sync** — client-side OAuth upload of generated PDFs + metadata to GCS, under the free tier.
3. **Forex & remittance realization** — invoice-date FX logging, remittance entries (date/time, FCY received, INR credited, bank charges, FIRC ref), auto-computed realized gain/loss.
4. **Ledger & reports** — double-entry ledger underlying all transactions; pending receivables (FCY + INR), realized forex summary by financial year, HUF P&L statement structured for the CA to file ITR-2/ITR-3 (no tax computation in-app — see Tax scope boundary above).
5. **Client directory** — billing address, country, default currency, tax ID, primary contact per client.
6. **AR aging dashboard** — 0–30/31–60/61–90/90+ day buckets.
7. **Chart of accounts / expense ledger** — simple expense categories (bank charges, software subscriptions, filing fees) for net income calculation.
8. **Audit trail** — immutable log of invoice creation, payment entries, PDF downloads, manual overrides.

## UI/UX

- Clean, minimalist enterprise look (Zoho Books / Stripe inspired), white-dominant theme with accent colors sampled from the brand crest (`assets/Logo.png`, served as `public/logo.png`): navy `#232b45`, burgundy `#6e2a34`, gold `#b8935f` — see the `:root` block in `src/app/globals.css` for exact tokens. Sidebar is light, not solid dark navy. Clear status indicators (Draft/Sent/Paid/Overdue) via the `--status-*` tokens.
- The crest logo (`BrandLogo` component, `src/components/brand-logo.tsx`) is used throughout: sidebar header, mobile top bar, PWA icons/favicon, and the animated boot splash (`app-boot-splash.tsx`, Framer Motion). Regenerate `public/icons/*` from `assets/Logo.png` if the logo ever changes (see git history for the generation script) rather than hand-editing the PNGs.
- Desktop: collapsible left sidebar, metric summary cards, filterable data tables, `Sheet` drawer panels for quick invoice entry.
- Mobile: thumb-friendly bottom nav, swipeable summary cards, mobile-optimized forms — this is a PWA meant to be used one-handed on a phone, not just a shrunk desktop layout.
- Loading states: `src/app/loading.tsx` (Skeleton-based) covers slow route transitions automatically via Next's App Router convention; data-bound UI (e.g. dashboard metric cards) should show `Skeleton` while its `useLiveQuery` result is `undefined` rather than a misleading placeholder value.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
