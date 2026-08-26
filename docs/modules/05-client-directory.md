# Module 5: Client Directory

## Purpose
Store client profiles used across invoicing, reports, and AR aging.

## Key concepts
- Fields: billing address, country, default currency, tax ID, primary contact.
- Historical invoices must not change if a client record is later edited (snapshot client details at invoice time).

## Non-goals
- No client-facing portal or client login — this directory is for Rahul's internal use only.

## User stories

**US-1**: As Rahul, I want to add a client with billing address, country, default currency, tax ID, and primary contact so I can invoice them without re-entering details each time.
- AC:
  - Required fields: name, country, default currency. Optional: tax ID, primary contact, billing address.
  - Client's default currency pre-fills new invoices for that client (editable per invoice).
  - Editing a client's details does not retroactively change already-issued invoices — each invoice stores a snapshot of client details as they were at invoice creation.
  - Deleting a client with existing invoices is blocked, or requires explicit confirmation and does not delete/alter the historical invoices.

**US-2**: As Rahul, I want to search/filter clients so I can find one quickly when invoicing.
- AC:
  - Client list is searchable by name and filterable by country.
  - Client list/search is usable on a mobile viewport (thumb-friendly, no horizontal scrolling required for basic search).
