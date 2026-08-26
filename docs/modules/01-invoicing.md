# Module 1: Invoicing

## Purpose
Create, manage, and PDF-export foreign-currency export-of-services invoices compliant with LUT/zero-rated IGST rules.

## Key concepts
- Serial number: `RGHUF/INV/{FY}/{seq}` — sequential within financial year, never reused (see CLAUDE.md).
- Status lifecycle: Draft → Sent → Paid / Overdue.
- FX rate is captured at invoice-date and frozen on the invoice record — reused later for forex realization (module 3), never recomputed.
- Currency list is user-configurable, not hardcoded (default USD/EUR).
- Every invoice PDF carries the exact IGST disclaimer text (see CLAUDE.md) and full bank wire details.

## Non-goals
- No invoice emailing/delivery integration (not requested — out of scope until asked for).
- No tax liability computation of any kind (see CLAUDE.md Tax scope boundary).

## User stories

**US-1**: As Rahul, I want to create a new invoice for a foreign client in their currency so I can bill for services rendered.
- AC:
  - Selecting a client pre-fills currency from the client's default; currency remains editable to any configured currency.
  - Serial number auto-generates as `RGHUF/INV/{FY}/{seq}`; sequence never reused, even if an invoice is later deleted/voided.
  - Invoice-date FX rate is entered/fetched and stored immutably on the invoice at creation time.
  - Cannot save without: client, currency, at least one line item with amount, invoice date, due date.
  - New invoice defaults to Draft status.

**US-2**: As Rahul, I want to generate a print-ready PDF of an invoice so I can send it to my client.
- AC:
  - PDF renders entirely client-side, no network required.
  - PDF includes the IGST export disclaimer verbatim (exact text from CLAUDE.md).
  - PDF includes HUF Bank Name, Account Number, IFSC, and SWIFT/BIC.
  - PDF is A4-sized and print-styled.
  - Each PDF download is recorded in the audit trail (module 8) with a timestamp.

**US-3**: As Rahul, I want to track an invoice's status so I know where it stands.
- AC:
  - Draft/Sent/Paid are set manually (or Paid auto-sets when a remittance fully covers the invoice — module 3).
  - Overdue is derived (due date passed, not fully paid) — computed at display time, not stored as a separate manual state.
  - Every status change is recorded in the audit trail with old value, new value, timestamp.

**US-4**: As Rahul, I want the currency list to be configurable so I can bill in currencies beyond USD/EUR without a code change.
- AC:
  - Currency list lives in app settings (IndexedDB-backed), editable via UI.
  - Adding/removing a currency requires no redeploy.
  - Existing invoices keep their original currency even if it's later removed from the active list.
