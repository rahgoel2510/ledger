# Module 8: Audit Trail

## Purpose
Immutable log of key actions across the app, for compliance assurance and to give the CA (or a future auditor) a defensible record.

## Key concepts
- Logged action types (minimum): invoice creation, status change, payment/remittance entry, PDF download, manual override.
- System-derived actions (e.g., auto-marking Paid) must be visually distinguishable from manual overrides.

## Non-goals
- Not a general application-log/telemetry system — scope is limited to compliance-relevant financial actions.

## User stories

**US-1**: As Rahul, I want every invoice creation, payment entry, PDF download, and manual override logged immutably so I have a defensible audit trail.
- AC:
  - Each audit entry records: timestamp, action type, entity affected (invoice/remittance/expense ID), and before/after values where applicable.
  - Audit entries cannot be edited or deleted through the UI, under any permission level.
  - Audit log is viewable and filterable by entity, action type, and date range.
  - Audit log entries are included in cloud backup (module 2) alongside invoice data.

**US-2**: As Rahul, I want manual overrides flagged distinctly in the audit trail so they're easy to spot during review.
- AC:
  - Manual overrides (e.g., manually marking an invoice Paid without a matching remittance) carry a distinct action type/visual flag, separate from system-derived actions (e.g., auto-marked Paid via module 3, US-4).
  - Filtering the audit log by "manual overrides only" is possible.
