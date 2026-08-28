---
name: scaffold-pwa
description: One-time bootstrap of the VrikshaFX Next.js PWA — app shell, Tailwind/Shadcn, PWA manifest + service worker, static export config, and the shared local-persistence foundation (types, Dexie schema, currency config). Run once, before implementing any functional module.
---

Scaffold VrikshaFX per `CLAUDE.md` (repo root — read it fully first, along with `docs/vision.md` for feature detail). This is a one-time setup step; every module built afterward (invoicing, forex ledger, reports, ...) assumes this exists.

## Steps

1. **Init the Next.js app**: TypeScript, App Router, Tailwind CSS at the repo root. Add Shadcn UI, `dexie`, a PDF library (`@react-pdf/renderer` or `jspdf` + `html2canvas`), and `lucide-react`.
2. **Static export + GitHub Pages config** in `next.config.js` (exact snippet is in `CLAUDE.md`) — `output: 'export'`, `images.unoptimized: true`, and a `basePath` set only in production.
3. **PWA setup**: a `manifest.json` (name, icons, theme color matching the Slate/Navy palette, `display: standalone`) and a service worker that caches the app shell for offline use. Confirm it works under static export — no dependency on a Next.js feature that needs a server at runtime.
4. **Shared local-persistence foundation** (kept minimal, no module-specific business logic yet):
   - `lib/types.ts` — shared types: `Currency`, `Invoice`, `Remittance`, `Client`, `ExpenseEntry`, matching the fields `CLAUDE.md`'s domain rules require (invoice-date FX rate, bank charges, FIRC reference, etc.).
   - `lib/db.ts` — Dexie/IndexedDB schema/instance covering invoices, remittances, clients, and expenses.
   - `lib/currencies.ts` — default currency config (INR base; USD/EUR secondary), structured to be user-extensible.
5. **App shell UI**: collapsible sidebar, top bar, root layout — matching the UI/UX section of `CLAUDE.md` (desktop sidebar + drawer forms, mobile bottom nav). Empty route stubs are fine; don't build full features here.
6. Verify `npm run build` succeeds (static export) before considering this done.
7. Report the exact shapes of `lib/types.ts`, `lib/db.ts`, and `lib/currencies.ts` so later work can build against them without re-deriving them.

Do not implement invoicing, forex realization, reports, client directory, or GCS sync here — those come after this foundation exists, done directly (no subagents — see `CLAUDE.md`).
