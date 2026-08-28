# Module 6: AR Aging Dashboard

## Purpose
Dashboard view of outstanding invoices bucketed by days overdue, computed from invoice due date.

## Key concepts
- Buckets: 0–30, 31–60, 61–90, 90+ days overdue.
- Reads from the same ledger/invoice state as modules 1, 3, and 4 — no separate aggregation path.

## User stories

**US-1**: As Rahul, I want outstanding invoices grouped into 0–30/31–60/61–90/90+ day buckets so I can prioritize follow-up.
- AC:
  - Bucket computed from (today − invoice due date); invoices with a future due date are excluded from all buckets.
  - Only unpaid/partially-paid invoices appear.
  - Each bucket shows invoice count and total outstanding amount, broken out by currency (FCY) and summed as INR-equivalent.
  - Clicking a bucket lists its invoices, each linking through to the invoice detail.

**US-2**: As Rahul, I want the AR aging view to update live as remittances are logged so it always reflects current state.
- AC:
  - Buckets recompute immediately (client-side, from IndexedDB) after a remittance is saved — no manual refresh or background job required.
  - An invoice that becomes fully paid via a remittance disappears from all buckets on the next render.
