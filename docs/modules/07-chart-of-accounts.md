# Module 7: Chart of Accounts / Expense Ledger

## Purpose
Simple expense categorization that feeds net income calculation via the double-entry ledger (module 4).

## Key concepts
- Default categories: Bank Charges, Software Subscriptions, Filing Fees — extensible by the user.
- Every expense entry posts to the double-entry ledger, same as invoices and remittances.

## Non-goals
- No multi-level/nested chart of accounts, no accrual-accounting complexity — this stays simple by design (per CLAUDE.md: "simple expense categories").

## User stories

**US-1**: As Rahul, I want predefined expense categories plus the ability to add my own so I can categorize spending.
- AC:
  - Default categories (Bank Charges, Software Subscriptions, Filing Fees) are seeded on first run.
  - User can add and rename categories via settings.
  - A category referenced by existing expenses cannot be hard-deleted — only deactivated (hidden from new-entry pickers, retained on historical entries).
  - Each expense entry requires: date, category, amount (INR), description.

**US-2**: As Rahul, I want each expense entry to post to the ledger automatically so it's reflected in reports without manual reconciliation.
- AC:
  - Saving an expense posts a balanced debit/credit entry to the double-entry ledger (module 4) at save time.
  - Category totals for a financial year are queryable and feed directly into the P&L export (module 4).
