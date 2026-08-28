# VrikshaFX Docs

Three layers, don't duplicate across them:

- **`vision.md`** — original raw product brief. Historical reference only.
- **`../CLAUDE.md`** — authoritative source for tech stack, architecture, domain rules (forex formula, serial numbering, IGST disclaimer text, tax scope boundary). Read this for *how* and *why*.
- **`modules/`** — this folder. One file per functional module: purpose, key concepts, user stories with acceptance criteria. Read this for *what to build and how to know it's done*.

If a module doc and CLAUDE.md ever disagree on a domain rule (formula, exact text, numbering scheme), CLAUDE.md wins — fix the module doc.

## Modules

| # | Module | Doc |
|---|--------|-----|
| 0 | PWA shell & offline | [modules/00-pwa-shell.md](modules/00-pwa-shell.md) |
| 1 | Invoicing | [modules/01-invoicing.md](modules/01-invoicing.md) |
| 2 | Cloud storage sync (GCS backup) | [modules/02-cloud-storage-sync.md](modules/02-cloud-storage-sync.md) |
| 3 | Forex & remittance realization | [modules/03-forex-remittance.md](modules/03-forex-remittance.md) |
| 4 | Ledger & reports | [modules/04-ledger-reports.md](modules/04-ledger-reports.md) |
| 5 | Client directory | [modules/05-client-directory.md](modules/05-client-directory.md) |
| 6 | AR aging dashboard | [modules/06-ar-aging.md](modules/06-ar-aging.md) |
| 7 | Chart of accounts / expenses | [modules/07-chart-of-accounts.md](modules/07-chart-of-accounts.md) |
| 8 | Audit trail | [modules/08-audit-trail.md](modules/08-audit-trail.md) |

## Conventions used in module docs

- User stories: `As Rahul, I want ... so that ...`
- Acceptance criteria (AC): testable, checkbox-style. If an AC can't be verified by looking at the app's behavior, it's not a valid AC.
- Each doc lists **Non-goals** where scope is easy to over-build (esp. re: [tax scope boundary](../CLAUDE.md#tax-scope-boundary-explicit-decision--do-not-expand-without-asking) — no tax liability computation anywhere in this app).
