# Module 4: Ledger & Reports

## Purpose
Maintain the double-entry ledger underlying every transaction, and produce CA-ready reports (pending receivables, realized forex summary, P&L). This module is the reason the tax scope boundary exists — read it before touching this file.

## Key concepts
- **Tax scope boundary (hard constraint):** this module computes and presents financial facts only. It never computes tax liability, slab rates, or advance tax — see [CLAUDE.md](../../CLAUDE.md#tax-scope-boundary-explicit-decision--do-not-expand-without-asking). Output is structured for the CA to file ITR-2/ITR-3, not a substitute for that filing.
- Every domain transaction (invoice issued, remittance received, expense recorded) posts balanced debit/credit entries to a double-entry ledger.
- Reports read from the ledger, not from ad-hoc aggregation of source tables — the ledger is the single computation path so numbers can't drift between views.

## Non-goals
- No tax liability calculators, slab-rate processors, or advance tax engines — ever, without the user explicitly re-opening this decision.
- No editing of posted ledger entries — corrections are reversing entries only.

## User stories

**US-1**: As Rahul, I want every invoice, remittance, and expense to post to a double-entry ledger automatically so my books stay internally consistent.
- AC:
  - Every domain transaction generates balanced debit/credit ledger entries at the time it's recorded.
  - Posted ledger entries are immutable; corrections happen via reversing entries, never in-place edits.
  - A ledger balance check (sum of debits = sum of credits) is available and passes at all times.

**US-2**: As Rahul, I want a pending receivables view so I know what's outstanding.
- AC:
  - Shows each unpaid/partially-paid invoice with original FCY amount, FCY received to date, and INR-equivalent outstanding.
  - Filterable by client and by currency.
  - Figures are read from the ledger, matching what module 3 and module 1 show for the same invoice.

**US-3**: As Rahul, I want a P&L statement export structured for my CA to file ITR-2/ITR-3 directly.
- AC:
  - Export includes: total foreign income realized (INR), bank charges, realized forex gains/losses, categorized expenses (module 7), net income.
  - Export is scoped to a selected financial year.
  - Export contains no tax liability, slab, or advance-tax figures anywhere.
  - Export format is a structured file (exact format — CSV vs. PDF — decided at implementation time), with clearly labeled sections.

**US-4**: As a new engineer or as Claude picking this codebase back up, I want the ledger's posting rules documented in code (not just in my head) so I can extend it safely.
- AC:
  - Each transaction type's debit/credit posting logic lives in one identifiable module/function, not scattered across UI components.
  - Adding a new transaction type (e.g., a future feature) has an obvious place to add its posting rule.
