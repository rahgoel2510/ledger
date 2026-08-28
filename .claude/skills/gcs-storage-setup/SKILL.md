---
name: gcs-storage-setup
description: Wire up client-side Google Cloud Storage backup of invoice PDFs within the always-free tier ($0 billing) — OAuth2 consent flow, upload/list client, and free-tier-safe usage patterns. Run after scaffold-pwa; this is optional backup, not a dependency for core app function.
---

Integrate Google Cloud Storage as an optional, client-side-only backup destination for generated invoice PDFs, per the Storage rules section of `CLAUDE.md`. Read that section first — this skill is the how-to for implementing it.

## What this is not

There is no backend in this app. GCS access happens directly from the browser using the signed-in user's own OAuth2 credentials — never a service-account key bundled into the frontend. If a task seems to require a server-held secret to talk to GCS, that's a sign to fall back to a simpler client-side-only approach (e.g. resumable uploads via the JSON API with a user access token), not to add a backend.

## Steps

1. **OAuth2 client-side flow**: use Google Identity Services (GIS) token client with the `https://www.googleapis.com/auth/devstorage.read_write` scope (narrower than full Drive/Cloud scope) to get a short-lived access token in the browser. Store nothing long-lived beyond what GIS itself handles — re-prompt for consent/token refresh rather than persisting a refresh token client-side.
2. **Upload client**: a small wrapper around the GCS JSON API (`storage.googleapis.com/upload/storage/v1/b/{bucket}/o`) that uploads a PDF blob with the object name following the `Rahul Goel HUF/Invoices/FY{year}/{serial}.pdf` convention from `CLAUDE.md`.
3. **Free-tier discipline** — the always-free GCS tier caps storage (~5GB), Class A/B operations, and egress per month:
   - Upload once per invoice PDF (on creation/regeneration), not on every view.
   - Don't poll or list the bucket on a timer; fetch listings only when the user opens a "cloud backup" view.
   - Surface upload failures (quota, auth expiry, offline) as a non-blocking status indicator — never block invoice creation or PDF download on cloud sync succeeding.
4. **Settings UI**: where the user connects their Google account, sees sync status per invoice, and can disable cloud backup entirely (app must be fully usable with this off — IndexedDB remains the source of truth).
5. Document, in a code comment at the top of the storage module (one line, not a block), that a GCS bucket and OAuth client ID must be created manually in Google Cloud Console before this works — that setup is outside what a coding session can do, since it requires the user's own GCP account.

## Non-negotiable rules
- Never write a GCP service-account key or long-lived secret into the repo or the client bundle.
- Cloud backup is additive — every feature (invoice creation, PDF download, forex calc) must work with it disabled or failing.
