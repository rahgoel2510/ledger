# Module 2: Cloud Storage Sync (GCS Backup)

## Purpose
Client-side backup of generated invoice PDFs + metadata to Google Cloud Storage, staying entirely within the always-free tier ($0 billing). Backup only — never a dependency for core function.

## Key concepts
- Bucket in a `US-*` free-tier-eligible region (see CLAUDE.md — India-region storage was considered and rejected because it breaks the $0 guarantee; app usage being India-only doesn't require India-region storage).
- OAuth2 consent flow using the user's own Google account — no service-account key ever ships in the frontend.
- Folder convention: `Rahul Goel HUF/Invoices/FY26-27/`.
- IndexedDB remains source of truth; every feature must stay fully functional if offline, unauthenticated, or the free tier is exhausted.

## Non-goals
- No automatic/eager sync of every change — uploads are explicit and batched.
- No cross-device merge or conflict resolution — this is one-way backup, not multi-device sync.
- No re-download of already-backed-up files just to "verify" state (wastes free-tier ops).

## User stories

**US-1**: As Rahul, I want to connect my Google account so I can back up invoices to GCS.
- AC:
  - OAuth2 consent flow runs entirely client-side; no secret embedded in the bundle.
  - Connected/disconnected state is visible in settings.
  - Disconnecting revokes the local token without deleting already-uploaded backups.

**US-2**: As Rahul, I want an invoice's PDF + metadata uploaded to GCS when I choose to back it up, so my records survive a device loss.
- AC:
  - Upload happens only on explicit user action, never automatically on every save/edit.
  - Upload path follows `Rahul Goel HUF/Invoices/{FY}/{serial-number}.pdf` plus a metadata JSON alongside it.
  - Upload failure (offline, quota exceeded, auth expired) never blocks or corrupts local invoice state.
  - Each invoice shows a backup status indicator: Not backed up / Backed up / Failed.

**US-3**: As Rahul, I want the app to work fully without GCS so I'm never blocked by cloud state.
- AC:
  - Every core feature (invoicing, ledger, reports, remittances) functions with GCS disconnected or offline.
  - No feature is gated behind cloud-auth state.

**US-4**: As Rahul, I want to stay inside the free tier without having to think about it.
- AC:
  - No feature triggers automatic re-uploads or re-downloads of unchanged data.
  - Bucket storage class/region matches the free-tier-eligible configuration documented in CLAUDE.md.
