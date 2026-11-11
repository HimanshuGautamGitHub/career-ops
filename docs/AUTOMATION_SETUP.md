# Automation setup: a hands-off daily job search with a GUI

This is the turn-key runbook for the four things most people want from career-ops:

1. **Scan for matching jobs every day** — unattended, zero tokens, local-first.
2. **Watch it work in a web app** — a daily activity view you open in your browser.
3. **Steer it from the UI** — change job titles, locations, pay, experience, and
   included/excluded companies without touching a config file by hand.
4. **Keep the results honest** — career-ops prepares applications but never clicks
   Submit for you (see [the ethics note](#a-word-on-applying-automatically)).

Everything here is **already built into this repo**. This page connects the pieces
and points you at the one step only you can do: telling the system who you are and
what you want (["Make the results yours"](#3-make-the-results-yours-personalization)).

> **Local-first, token-free scanning.** The daily scan reads *public* job-board APIs
> and appends matches to your local `data/pipeline.md`. None of your CV, profile, or
> pipeline data leaves your machine, and the scan itself spends no model tokens.
> Evaluating a shortlisted role later is the only step that costs tokens.

---

## 1. Turn on daily scans

The scanner is safe to run unattended: it is idempotent (already-seen URLs are
deduped) and token-free. The actual *scheduling* is left to your operating system,
and the recipes already live in **[docs/AUTOMATION.md](AUTOMATION.md)**. There are
two ways to schedule, and you only need one:

- **Path A — a fixed daily scan.** Put `node scan.mjs` on cron (Linux), launchd
  (macOS), or Task Scheduler (Windows). Copy-paste recipes:
  [AUTOMATION.md → "Fixed scan with scan.mjs"](AUTOMATION.md#a-fixed-scan-with-scanmjs).
  This is the simplest option and needs no web server running.

- **Path B — the web app's Scheduled scans page.** Create one or more cadences in
  the GUI (daily, every few days, weekdays only), then install a single 15-minute
  queue worker with the OS scheduler so due scans fire on their own. One-line
  installers ship for every platform:
  [AUTOMATION.md → "Scheduled scans page (web UI)"](AUTOMATION.md#b-scheduled-scans-page-web-ui).

  ```bash
  # macOS / Linux (run from the repo root)
  sh web/scripts/install-scan-schedule.sh      # add the queue worker
  sh web/scripts/uninstall-scan-schedule.sh    # remove it
  ```

  ```powershell
  # Windows (PowerShell)
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File web/scripts/install-scan-schedule.ps1
  ```

Under the hood, Path B runs `web/scripts/scheduled-jobs-runner.mjs` on each tick: it
picks up any scan that is due, runs `scan.mjs` (a "portals" scan of your tracked
companies) or `scan-ats-full.mjs` (a wide reverse-ATS sweep) with the filters you
set in the UI, appends new matches to `data/pipeline.md`, and records the run so the
GUI can show it. You never call that script by hand — the scheduler does.

> **Choosing the cadence.** A daily scan is the simplest mental model; the scanner's
> dedup absorbs the days with nothing new, so running it daily costs you nothing
> extra. See AUTOMATION.md for a weekday-only or every-3-days variant.

---

## 2. Watch it work in the web app

Launch the local dashboard (details in [docs/WEB_UI.md](WEB_UI.md)):

```bash
npm --prefix web ci   # one-time: install the web app's dependencies
npm run ui            # starts http://127.0.0.1:3000 and opens your browser
```

Everything is local and served from `127.0.0.1`. The left-hand navigation is where
your daily automation surfaces:

| Page | What it shows you |
|------|-------------------|
| **Today** (`/`) | Your at-a-glance start screen: applications awaiting a decision and the fresh discoveries sitting in your inbox. |
| **Scheduled scans** (`/scheduled-scans`) | The cadences you created, plus a run-history drawer per job — each run shows when it fired and how many matching roles it found. This is where you confirm the daily scan is actually firing. |
| **Pipeline** (`/pipeline`) | The newly-scanned postings (`data/pipeline.md`) queued for evaluation. |
| **Explore** (`/explore`) | Browse and triage discoveries. |
| **Analytics** (`/analytics`) | Your funnel over time — how many scanned, evaluated, applied, interviewing. |
| **Portals** (`/portals`) | Your search targets and filters (see the next section). |
| **CV** / **Documents** / **Config** | Your CV, uploaded docs, and settings. |

If a scheduled scan ran overnight, you will see its run in **Scheduled scans** with a
matching-role count, and any new postings in **Pipeline**. That is the "see the agent
work every day" view.

---

## 3. Make the results yours (personalization)

> **This step is yours to do — the engineer who set up this automation did not, and
> must not, do it for you.**

Out of the box the scanner has no idea who you are or what you want, so a freshly
cloned repo will match little or nothing useful. Two things make the results real,
and both live in **candidate-owned files** that career-ops treats as yours alone and
never overwrites on an update (the "User Layer" in
[DATA_CONTRACT.md](../DATA_CONTRACT.md)):

- **`portals.yml`** — your search targets and filters: job-title keywords,
  locations (remote / hybrid / specific cities and countries), pay floor, years of
  experience, which companies to track, and which companies to exclude.
- **`config/profile.yml`** and **`modes/_profile.md`** — who you are and what you are
  targeting: name, contact, target roles, salary range, and the narrative used to
  score and tailor matches.

You do **not** edit these by hand. Instead:

- **Run the onboarding / `intake` flow.** Start career-ops in your AI CLI and it will
  walk you through setup — paste your CV or LinkedIn URL and it writes a first
  `cv.md`, `config/profile.yml`, and a 45+ company `portals.yml` for you. The
  `intake` mode can also read documents you drop in `documents/` (a master CV, a
  LinkedIn export) and propose source-annotated additions. See
  [docs/SETUP.md](SETUP.md) for the walkthrough. Nothing is written without your
  confirmation.
- **Tune filters from the GUI afterward.** The **Portals** and **Config** pages let
  you change titles, locations, pay, experience, and the included/excluded company
  lists directly — no YAML editing required.

Until you personalize, treat the daily scan as a plumbing check (it proves the
pipeline runs), not a real job feed.

---

## A word on applying automatically

career-ops will research a role, tailor your CV and cover letter for ATS keyword
coverage, surface skill gaps, and **pre-fill application forms** — but by design it
**stops before pressing Submit**. You review and send every application yourself.
This is a deliberate quality-over-quantity stance, not a missing feature. See the
"Ethical Use" and "Apply scope" sections of [AGENTS.md](../AGENTS.md).

---

## Verify the pipeline without touching your data

You can prove the whole scan path works end-to-end against a *throwaway* data root,
so none of your real files are involved. Point `CAREER_OPS_ROOT` at an empty
directory with a minimal `portals.yml`:

```bash
# A scratch data root, deleted when you're done — your real data is untouched.
ROOT="$(mktemp -d)"
mkdir -p "$ROOT/data" "$ROOT/config"
cat > "$ROOT/portals.yml" <<'YAML'
title_filter:
  positive: [engineer, developer, scientist, manager]
  negative: [intern]
tracked_companies:
  - name: Anthropic
    careers_url: https://job-boards.greenhouse.io/anthropic
    api: https://boards-api.greenhouse.io/v1/boards/anthropic/jobs
    enabled: true
YAML

# Dry-run (reads the public API, writes nothing):
CAREER_OPS_ROOT="$ROOT" node scan.mjs --dry-run --company Anthropic

# Real run (appends matches to $ROOT/data/pipeline.md):
CAREER_OPS_ROOT="$ROOT" node scan.mjs --company Anthropic
grep -c '^- \[ \]' "$ROOT/data/pipeline.md"   # count of queued postings
```

A non-zero count means the scanner read a live job board, filtered, and wrote
pipeline entries — the exact work the daily scheduler automates for you.
