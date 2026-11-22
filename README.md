# Repo Timelapse

An animated, private dashboard of my GitHub repos: **commits**, **lines of code** and **repo size** over time. Each metric has an animated version (exportable as MP4/WebM) and a static version (exportable as PNG/SVG/CSV).

**Live:** https://zaahieradams.github.io/repo-timelapse/ (Google sign-in; only `zaahier.ada@gmail.com` can see data)

This repo is public, but it only holds code. The stats, which include private repo names, live in Supabase behind Google sign-in.

## How it works

```
 nightly GitHub Action ──(OIDC token)──▶ Supabase edge function ──▶ repo_stats.dataset (private schema)
   clones every repo,                      verifies the token came                     │
   replays full git history                from this repo's collect.yml on main         │ public.repo_timelapse_get()
                                                                                        ▼  (Google identity must be the owner)
                                     GitHub Pages ◀── Vite app (canvas renderer) ◀── signed-in browser
```

- **`collector/collect.py`** builds a daily series per repo straight from git:
  - **Commits:** non-merge commits on any branch, dated by author time (Africa/Johannesburg).
  - **Lines of code:** a running sum of `git log --numstat` along the default branch's first-parent history, counting source files only. Lockfiles, minified or generated files, build output, `node_modules`, hidden folders and scratch folders (`_to_delete`, `Claude outputs`, …) are excluded. At HEAD this matches an actual line count of the same files.
  - **Size:** total bytes of all tracked files (`git ls-tree -l`) at the end of each active day, assets included.
  - **Languages:** lines of code per language, snapshotted daily.
  - **Tags** become release markers on the chart.
- **`supabase/`** contains the schema and RPCs (`migrations/`) and the ingest function (`functions/repo-timelapse-ingest`). Both are deployed to the Nest-app Supabase project. The data sits in its own `repo_stats` schema, which the Supabase API doesn't expose.
- **`web/`** is a Vite + TypeScript app with a hand-written Canvas renderer, and is deployed to GitHub Pages by `deploy.yml`.

## Features

- Animated line race: lines draw forward behind a moving date cursor, the y-axis rescales smoothly, labels follow each line's tip, and a new repo appears with a pulse on its first commit.
- Static view with a crosshair tooltip showing every repo's value on the hovered day.
- **Cumulative** or **per week** (commits per week, or net change in lines or size per week), plus log scale and an all-repos total line.
- Date range presets (the default is **1 May 2026 to today**) and custom ranges.
- Summary tiles, live language mix, a daily commit heatmap, and a data table.
- Exports:
  - PNG (3200×1800) and SVG.
  - CSV of the current view.
  - Video in 16:9, 1:1 and 9:16 (MP4 where the browser supports it, otherwise WebM).
- Click a repo to toggle it. Alt- or ⌘-click shows only that repo. The URL keeps the current view, so links are shareable.
- Keyboard: <kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd> step a day (hold <kbd>Shift</kbd> for a week), <kbd>Home</kbd> restart.

## One-time setup

1. **Token for reading private repos.** Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - Resource owner: `ZaahierAdams`
   - Repository access: **All repositories**
   - Permissions: **Contents: Read-only** (Metadata is read-only automatically)

   Save it in this repo under *Settings → Secrets and variables → Actions → New repository secret* as **`STATS_GITHUB_TOKEN`**.
2. **Pages.** Go to *Settings → Pages → Build and deployment → Source* and choose **GitHub Actions**.
3. **Supabase redirect URL.** In Nest-app, go to *Authentication → URL Configuration → Redirect URLs* and add `https://zaahieradams.github.io/repo-timelapse/`.
4. Run **Actions → Collect repo stats → Run workflow** once. After that it runs every night.

Optional: set a repository variable named `TIMELAPSE_EXCLUDE` to a comma-separated list of repo names to skip.

### Fork safety

The collector never caches clones and never commits data back. The ingest function only accepts OIDC tokens issued to `collect.yml` on `main` of this repo, under owner id `58355846`. Secrets and OIDC tokens are never available to pull requests from forks.

## Local development

```bash
cd web && npm install
# with real auth:
npm run dev                       # http://localhost:5173/repo-timelapse/
# with a local stats file and no auth (dev only):
python ../collector/collect.py --clones ~/clones --out __local/stats.json   # bare clones named <repo>.git
open "http://localhost:5173/repo-timelapse/?local=1"
```

`web/__local/` is gitignored, so stats never land in this public repo.
