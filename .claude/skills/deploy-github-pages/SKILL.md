---
name: deploy-github-pages
description: Set up (or re-verify) the GitHub Actions workflow that builds VrikshaFX's static export and publishes it to GitHub Pages. Run once to set up CI, and re-check after any next.config.js or routing change.
---

Set up automated GitHub Pages deployment for VrikshaFX's static export, per the GitHub Pages export config in `CLAUDE.md`.

## Steps

1. Confirm `next.config.js` has `output: 'export'`, `images.unoptimized: true`, and the production-only `basePath` (see `CLAUDE.md`) — the workflow will silently ship a broken (asset-404) site otherwise.
2. Add `.github/workflows/deploy.yml`: on push to `prod` (not `main` — see "Branching" in `CLAUDE.md`; `main` is the integration branch, `prod` is what's live and is what `sync-prod.yml` mirrors `main` onto automatically), run the full verify suite (lint, `next typegen` + `tsc --noEmit`, E2E), then `npm run build` (produces the static export in `out/`), then publish via the `actions/upload-pages-artifact` + `actions/deploy-pages` actions (the standard Actions-based Pages flow — not a `gh-pages` branch push, unless the repo is already set up that way).
3. Confirm the repo's Pages settings need to be set to "GitHub Actions" as the source — this is a one-time manual step in the repo's Settings → Pages UI, which a coding session can't do; call it out to the user rather than silently assuming it's set.
4. Static export has no server, so client-side routing must not depend on rewrites the Pages host won't do — verify all routes are pre-rendered pages under `output: 'export'` (no dynamic server routes).
5. After the workflow file exists, don't push/trigger a deploy without the user's go-ahead — creating the workflow is safe and reversible; triggering a live deploy to a public URL is a visible action to confirm first.
