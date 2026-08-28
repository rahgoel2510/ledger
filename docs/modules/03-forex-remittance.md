# Module 3: Forex & Remittance Realization

## Purpose
Record actual receipt of foreign remittances against invoices and auto-compute realized forex gain/loss per the fixed formula in CLAUDE.md.

## Key concepts
- Formula: `Realized Forex Gain/Loss = INR Credited − (FCY Received × Invoice Date FX Rate) − Bank Charges`.
- The FX rate used is always the one frozen on the invoice at creation time (module 1) — never the remittance-date rate, never re-fetched.
- Each remittance requires a FIRC (Foreign Inward Remittance Certificate) reference — mandatory, not optional metadata.
- An invoice may have multiple partial remittances.

## Non-goals
- No tax computation on realized gains/losses (see CLAUDE.md Tax scope boundary) — this module only records what happened financially.

## User stories

**US-1**: As Rahul, I want to log a remittance against an invoice so I can record what was actually received.
- AC:
  - Remittance entry requires: receipt date, receipt time, FCY received, INR credited, bank charges (INR), FIRC reference.
  - Cannot save a remittance without a linked invoice.
  - Multiple partial remittances can be logged against one invoice; running total of FCY received is tracked against the invoice total.
  - FIRC reference is a required field, save is blocked without it.

**US-2**: As Rahul, I want the realized forex gain/loss to auto-calculate when I log a remittance so I don't do the math by hand.
- AC:
  - Gain/loss computed and stored at remittance entry time using the exact formula above.
  - The FX rate read is the invoice's frozen invoice-date rate, sourced from the invoice record — never re-fetched or recalculated from a live rate.
  - Editing a saved remittance's figures triggers recalculation; viewing a report never does.

**US-3**: As Rahul, I want to see realized forex gain/loss summarized by financial year so I can hand it to my CA.
- AC:
  - Summary aggregates all remittances' realized gain/loss within a financial year (Apr–Mar).
  - Summary is included in the P&L export (module 4) in CA-consumable form.

**US-4**: As Rahul, when an invoice is fully covered by its remittance(s), I want it marked Paid automatically.
- AC:
  - Invoice status transitions to Paid once cumulative FCY received across its remittances meets/exceeds the invoice total.
  - This transition is recorded in the audit trail (module 8) as a system-derived action, distinct from a manual override.
