# Module 0: PWA Shell & Offline

## Purpose
Installable, responsive app shell that works fully offline. This is the foundation every other module runs on — no feature may assume network availability.

## Key concepts
- Static export (`output: 'export'`), no server/API routes at runtime.
- Web app manifest + service worker cache the app shell for install + offline use.
- IndexedDB (Dexie) is the source of truth for all data — see [04-ledger-reports.md](04-ledger-reports.md).

## Non-goals
- No push notifications, background sync, or native-app-only APIs.
- No server-rendered or server-computed content of any kind.

## User stories

**US-1**: As Rahul, I want to install the app to my home screen / desktop so it feels like a native app.
- AC:
  - App is installable via the browser's install prompt (manifest has required icons, name, `display: standalone`).
  - Installed app opens without browser chrome.
  - Works identically whether launched installed or via browser tab.

**US-2**: As Rahul, I want the app to load and be usable with no internet connection so I can work anywhere.
- AC:
  - App shell (HTML/JS/CSS) loads offline after first visit, via service worker cache.
  - All CRUD operations (invoices, clients, remittances, expenses, ledger) work with network disabled.
  - No blank screen or unhandled fetch failure when offline — the only network-dependent feature is GCS backup (module 2), which degrades gracefully.

**US-3**: As Rahul, I want a visible indicator when the app is offline so I'm not confused about why cloud backup isn't happening.
- AC:
  - Online/offline state is shown somewhere persistent in the UI (e.g., header badge).
  - Offline state does not block or gray out any core (non-cloud) feature.

**US-4**: As Rahul, I want the app usable one-handed on a phone, not just a shrunk desktop layout.
- AC:
  - Mobile viewport uses bottom nav (thumb reach), not a collapsed desktop sidebar.
  - Primary actions (new invoice, log remittance) are reachable within one thumb stretch on a standard phone screen.
