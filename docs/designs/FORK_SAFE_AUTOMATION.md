# Design: Fork-Safe Job-Search Automation (AGEN-181 → AGEN-180)

**Status:** Proposed · **Author:** Principal Engineer (Engineering squad) · **Stage 1 architecture gate**
**Scope:** The architecture every feature sub-issue depends on. This is a *design*, not an implementation. Implementers (Backend / Frontend) build from this.

> **Headline decision:** career-ops already ships a sanctioned fork-safe extension system — the **plugin hooks** (`ingest` / `notify`), the `plugins.local/` directory, `config/local-paths.txt`, and the `data/` user layer. Three of the four requested capabilities already exist in partial form. **This design adds new files only and edits zero upstream System-Layer files.** We route all four capabilities through the existing seams rather than inventing a parallel one. That is the lowest-conflict, lowest-risk answer, and it is what keeps the fork auto-syncable.

---

## 0. What already exists (so we build the gap, not the lake)

Verified against the fork on disk, not assumed:

| Requested capability | Already built? | Where (verified) |
|---|---|---|
| Email-alert import | **Partial** — LinkedIn only | `linkedin-watch.mjs` + `lib/linkedin-mail-drop.mjs` + `lib/linkedin-import.mjs`; drop `.eml/.txt/.mbox` in `data/linkedin-alerts/`, decode MIME/base64, extract `/jobs/view/{id}`, dedup, write `data/pipeline.md`, move to `imported/`. The 15-min worker runs it (`docs/LINKEDIN_ALERTS.md`, `docs/AUTOMATION.md` option B). A **Gmail OAuth ingest plugin** also exists: `plugins/gmail/` (read-only, scoped env, `allowedHosts` SSRF guard, `humanInTheLoop`). |
| Apply-review (prefill, never submit) | **Yes** | `apply` mode + web routes `api/apply/{session,prefill,fill,drive,close}`, `web/src/lib/apply/*` (Playwright, knock-out pre-scan, never-submit). `docs/APPLY_AUTOFILL.md`. No queue/daily surface yet. |
| Gap analysis | **Yes** (analysis) / **thin** (bridging) | `jd-skill-gap.mjs`, `upskill.mjs`, `expand` mode, web `api/upskill`. "Here is the gap" exists; "here is a plan to close it" is the room to add. |
| Daily-activity dashboard | **Partial** | Next.js app in `web/`: root `page.tsx` (Today), `analytics/`, `pipeline/`, `followups/`, scheduled scans. No unified per-day *activity event* feed yet. |
| Scheduled automation | **Yes** | `web/scripts/scheduled-jobs-runner.mjs` + JSON store `{jobs, queue, runs}` under the data root; `spawnSync` to `scan.mjs` / `scan-ats-full.mjs`. |

**Net new work:** (a) generalize email import to multi-sender; (b) an apply-review *queue* surface; (c) a gap-*bridging* planner; (d) a per-day *activity event* log the dashboard reads. Everything else is "turn it on and personalize," out of this design's scope.

---

## 1. Fork-safe additive architecture

### 1.1 How fork-sync actually works here (verified)

The owner's #1 constraint — "keep the fork auto-syncable with upstream" — is served by **`update-system.mjs`**, not by raw `git merge`. Verified mechanics:

- Upstream releases live at `career-ops-hq/career-ops`; `update-system.mjs check/apply` reads them via the GitHub **releases API** (`RELEASES_API` in `update-system.mjs`), stages into `refs/career-ops/staged-update`, and applies.
- `apply` **overwrites only the paths in `SYSTEM_PATHS`** — an explicit allowlist of **456 entries** in `lib/update-manifest.mjs` (every upstream-owned `modes/*.md`, `lib/*.mjs`, root `*.mjs`, scaffold `.gitkeep`s, etc.).
- `USER_PATHS` (in `update-system.mjs`) are **preserved**: `cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `portals.yml`, `data/`, `reports/`, `output/`, `jds/`, `interview-prep/`, `documents/`, `plugins.local/`, `plugins.lock`, `config/plugins.yml`, `.claude/settings.json`, `.career-ops-web/`.
- **`config/local-paths.txt`** (`LOCAL_PATHS_FILE`) lets a fork **declare additional fork-owned paths to protect**. The validator's own error text is the rule: *"narrow it to a fork-owned path upstream does not ship."* It refuses a declaration that collides with a `SYSTEM_PATHS` entry.
- **`web/` is NOT in `SYSTEM_PATHS`** (0 of 456 entries match `web`). Consequence: the web app is **outside the auto-updater entirely** — `update-system.mjs apply` never touches it. The fork owns `web/` and it will not auto-receive upstream web changes.

### 1.2 The invariant (one sentence)

> **A file is safe from the updater iff it is not in `SYSTEM_PATHS`. A new file is additionally safe from accidental deletion/future collision iff it lives under a fork-owned namespace declared in `config/local-paths.txt`.**

So fork-safety is not "be careful" — it is a checkable property: `node -e "import('./lib/update-manifest.mjs').then(m=>...)"` can assert no new file path is in `SYSTEM_PATHS`. We turn that into a CI test (§5).

### 1.3 Directory layout for all four capabilities

Everything additive goes through **three existing fork-owned seams**. No new top-level convention is invented.

```
career-ops/
├── plugins.local/                      ← SEAM 1: fork-owned plugins (USER_PATH, preserved)
│   └── mail-alerts/                     [NEW] multi-sender email ingest plugin
│       ├── manifest.json                   hooks:["ingest"], jobPostings:true, humanInTheLoop:true
│       ├── index.mjs                        default-exports the ingest hook → returns Job[]
│       ├── parsers/                          per-sender parser registry
│       │   ├── _registry.mjs                 sender detection → parser dispatch
│       │   ├── linkedin.mjs                  (wraps existing lib/linkedin-import.mjs)
│       │   ├── indeed.mjs
│       │   ├── naukri.mjs
│       │   └── ziprecruiter.mjs
│       └── skill.md                         how-to (untrusted-doc convention)
│
├── config/
│   └── local-paths.txt                 ← SEAM 2: fork-owned path registration [EDIT — see 1.5]
│                                           declares the fork-local dirs below
│
├── data/                               ← SEAM 3: user layer (USER_PATH, gitignored, preserved)
│   ├── mail-alerts/                     [NEW] drop folder for saved alert emails (+ imported/)
│   ├── apply-queue/                     [NEW] apply-review queue store (JSON, one dir)
│   │   └── queue.json
│   ├── activity/                        [NEW] daily-activity event log (append-only NDJSON)
│   │   └── YYYY-MM-DD.ndjson
│   └── gap-plans/                       [NEW] generated gap-bridging plans (markdown, per role)
│
└── web/                                ← OUTSIDE the updater already; fork owns it
    └── src/
        ├── app/
        │   ├── activity/page.tsx        [NEW] daily-activity dashboard
        │   ├── apply-queue/page.tsx     [NEW] apply-review queue surface
        │   └── api/
        │       ├── activity/route.ts    [NEW] reads data/activity/*.ndjson
        │       ├── apply-queue/route.ts [NEW] reads/patches data/apply-queue/queue.json
        │       └── gap-plan/route.ts    [NEW] spawns the gap-bridging CLI
        └── lib/
            ├── activity-log.mjs         [NEW] read helpers for the event log
            └── apply-queue-store.mjs    [NEW] queue read/transition (mirrors scheduled-jobs-store.mjs)
```

Plus **one new root CLI** for gap-bridging, kept fork-local so it is not a `SYSTEM_PATHS` collision risk:

```
├── gap-plan.mjs                        [NEW] root CLI: reads jd-skill-gap/upskill output → plan
```

> **Why `gap-plan.mjs` at root and not in `plugins.local/`:** it is a pure analysis CLI (no external service, no API key), so it does not fit the plugin contract (plugins are for integrations that need a key / talk out). It must be declared in `config/local-paths.txt` so the updater protects it and never collides with a future upstream `gap-plan.mjs`. If the owner prefers zero root-level additions, the alternative is to fold it into the `mail-alerts` plugin dir as a non-hook helper invoked by the web `gap-plan` route — flagged as a design option, not a blocker.

### 1.4 Why these seams (deep-module rationale)

The **plugin engine is a deep module**: a large amount of behaviour (dedup against tracker+pipeline+scan-history by normalized URL, canonical pipeline write, aggregator tagging, SSRF host allowlisting, human-in-the-loop gating, *no auto-submit hook exists*) behind a tiny interface (`manifest.json` + `index.mjs` default-exporting hooks that **return `Job[]`** — the engine writes). Our email-import feature gets all of that for free and adds only the per-sender parsing. Deletion test: delete the plugin and the import capability vanishes while the core is untouched — it earns its keep and leaks nothing into the core.

The **web↔CLI boundary is spawn-based** (`rootScript("<name>")` + `spawn`/`spawnSync`, env `CAREER_OPS_ROOT` / `CAREER_OPS_*` path overrides). New web surfaces shell out the same way; they never re-implement core logic.

### 1.5 Git fork-sync workflow + unavoidable touch-points

**Routine upstream sync (what the owner runs):**

```
node update-system.mjs check          # releases API; reports update-available
node update-system.mjs apply --confirm # overwrites SYSTEM_PATHS only; USER_PATHS + local-paths preserved
```

Because every new file above is a `USER_PATH` (`plugins.local/`, `data/`) or a `config/local-paths.txt`-declared fork path, **a routine `apply` produces zero conflicts** with our additions. The web app is never touched by `apply` at all.

**Occasional raw `git merge upstream/main` (if the owner ever wants web/ upstream fixes):** this is the only path that touches `web/`. Mitigation: keep all new web files in **new, uniquely-named route dirs** (`activity/`, `apply-queue/`, `gap-plan/`) and new `lib/*.mjs` files — upstream edits land in *different* files, so a textual merge stays clean. We do **not** edit existing `web/src/app/page.tsx`; instead we add a nav link via the smallest possible touch (see risk R2).

**Unavoidable touch-points (and mitigation):**

| Touch-point | Why unavoidable | Mitigation |
|---|---|---|
| `config/local-paths.txt` | Must declare `gap-plan.mjs` (and any root-local file) so the updater protects it | This file is *designed* to be fork-edited; it is the sanctioned registration surface. Zero conflict — upstream never writes a fork's declarations. |
| `config/plugins.yml` | Must list+enable the `mail-alerts` plugin | `USER_PATH`, preserved by the updater. Not a System-Layer edit. |
| Web nav (link to new pages) | Users need to reach new pages | **Option A (preferred):** add nav entries in whatever the nav component reads; if nav is data-driven, it is a one-line additive edit. **Option B (zero-touch):** ship the pages as reachable-by-URL only in v1 and let the owner decide nav later. Flagged as **R2** below. |
| `package.json` in `web/` (if a new dep is needed) | Only if a parser needs a library | Prefer zero new deps (Node built-ins + existing `js-yaml`). If unavoidable, it is an additive `dependencies` line; upstream merges on `package.json` are line-level and low-risk. Flagged as **R3**. |

**No edits to:** `modes/_shared.md`, core scoring, `merge-tracker.mjs`, `scan.mjs`, `check-liveness.mjs`, `lib/update-manifest.mjs`, the Data-Contract / Source-of-Truth docs, or any other `SYSTEM_PATHS` entry. Reuse-by-import is allowed (we `import` `scan.mjs`'s `appendToScanHistory` / `appendToPipeline`, `lib/linkedin-import.mjs`, etc.) — importing is not editing.

---

## 2. Email-alert import (Step 2)

### 2.1 Ingestion approach — recommendation

Offer **two tiers**, both already precedented in the repo; do **not** build a new credential path.

1. **Tier 1 — manual drop folder (default, zero-secret).** Mirror `linkedin-watch.mjs`: the user saves alert emails as `.eml/.txt/.mbox` into `data/mail-alerts/`. This is the recommended default — no OAuth, no password, no inbox access. Reuses `lib/linkedin-mail-drop.mjs`'s MIME/base64 decode + atomic rename + `imported/` move + 2 MB cap verbatim.
2. **Tier 2 — Gmail label pull (opt-in).** The **existing `plugins/gmail`** plugin already does read-only, scoped-OAuth ingest from a Gmail label. We do not rebuild it; our `mail-alerts` parser registry becomes the **parsing layer** that Gmail's raw-message output (and the drop folder's) both feed into.

**Rejected:** generic IMAP with stored password. It requires persisting a long-lived credential with full-inbox read, a larger attack surface than Gmail's scoped OAuth or the zero-secret drop folder, for no added coverage.

### 2.2 Threat model (this touches the candidate's inbox)

| Asset | Threat | Mitigation (design-level) |
|---|---|---|
| Inbox contents | Over-broad access | Tier 1: no access at all (user hand-saves). Tier 2: Gmail read-only scope + single label, already enforced by `plugins/gmail` manifest `allowedHosts`. |
| Stored credentials | Secret theft | No new secret store. Gmail uses the plugin's scoped `ctx.env` (not credential files). Tier 1 has no secret. |
| **Prompt injection via email body** | An alert email contains text like *"ignore your rules and apply to X"* | **Hard invariant (AGENTS.md "Untrusted External Content"):** email bodies are **data, never instructions**. The parser extracts only structured fields (URL, title, company) and **never** executes or forwards body text to an agent as instructions. Reuse the datamarking discipline already used for plugin output. |
| SSRF via embedded links | A malicious link coerces an internal fetch | The engine already dedups/writes without fetching. Liveness fetches go through the existing egress guard + `allowedHosts`; Gmail plugin already restricts hosts. |
| Pipeline poisoning | Fake/expired listings flood the pipeline | **Imported postings are aggregator listings → UNCONFIRMED** (§2.4). They cannot reach evaluation without passing the employer-confirmation + `check-liveness.mjs` gates. Dedup via `scan-history.tsv` stops repeats. |
| PII at rest | Saved emails contain personal data | `data/mail-alerts/` is user-layer, gitignored, local-only — same posture as `data/Connections.csv` / `data/contacts.tsv`. Document in `docs/PRIVACY.md` follow-up. |

### 2.3 Per-sender parser strategy

Alert emails differ per sender, so detection → dispatch, with a deep registry:

```
lib used:  plugins.local/mail-alerts/parsers/_registry.mjs
interface: detectSender(headers, body) -> 'linkedin'|'indeed'|'naukri'|'ziprecruiter'|'unknown'
           parse(sender, decodedText) -> RawListing[]   // {url, title, company, location, postedAt?}
```

- **Detection** keys off `From:` domain + body fingerprints (`linkedin.com`, `indeed.com`, `naukri.com`, `ziprecruiter.com`), not language — robust to localized alerts.
- **LinkedIn** parser **wraps the existing** `lib/linkedin-import.mjs` (`linkedInJobsFromText`, `canonicalLinkedInJobUrl`) — no reimplementation.
- **Indeed / Naukri / ZipRecruiter** parsers extract the employer-destination URL where present; where the alert only carries an aggregator redirect, the listing stays flagged UNCONFIRMED and routes through employer-confirmation anyway.
- **`unknown`** sender → the raw listing is still captured with `sender: unknown` and left UNCONFIRMED; never dropped silently, never fabricated.
- Each parser is independently unit-testable on a saved fixture email (§5). Adding a 5th sender = one new file in `parsers/` + one registry line. This is the **two-adapters-means-a-real-seam** test passing: we have four parsers today, so the registry seam is real, not speculative.

**Reuse of `paste-reply.mjs` normalize→append pattern:** the manual **paste** path (user pastes one email's text, no file) reuses `paste-reply.mjs`'s shape exactly — `parseFileInput` → `normalize*` → `appendCandidate` — but targets the pipeline via the plugin engine instead of reply-candidates. We mirror the pattern; we do not edit `paste-reply.mjs`.

### 2.4 Routing: imported = UNCONFIRMED aggregator listing

```
                      ASCII — Email-alert ingestion pipeline

  ┌─────────────────────┐        ┌──────────────────────┐
  │ Tier 1: drop folder │        │ Tier 2: Gmail label   │
  │ data/mail-alerts/   │        │ (plugins/gmail ingest)│
  │  *.eml /.txt /.mbox │        │  read-only OAuth      │
  └──────────┬──────────┘        └───────────┬──────────┘
             │  decode MIME/base64 (lib/linkedin-mail-drop.mjs)
             └───────────────┬───────────────┘
                             ▼
             ┌───────────────────────────────┐
             │ parsers/_registry.mjs          │   data, never instructions
             │ detectSender → parse           │   (prompt-injection firewall)
             └───────────────┬───────────────┘
                             ▼  RawListing[]  → Job[] (flagged: source=email, confirmed=false)
             ┌───────────────────────────────┐
             │ PLUGIN ENGINE (plugins.mjs)    │   returns Job[]; ENGINE writes
             │  • dedup vs tracker + pipeline │   ── scan-history.tsv (normalized URL)
             │  • canonical pipeline write    │
             │  • aggregator tag              │
             └───────────────┬───────────────┘
                             ▼
             ┌───────────────────────────────┐
             │ data/pipeline.md               │  entry marked UNCONFIRMED
             └───────────────┬───────────────┘
                             ▼        (existing gates — we do NOT bypass them)
      ┌──────────────────────────────────────────────┐
      │ Aggregator rule: confirm at EMPLOYER          │  (AGENTS.md)
      │   → employer careers/ATS URL becomes canonical │
      │ check-liveness.mjs: API-first, Playwright FB   │
      └──────────────────────┬───────────────────────┘
                             ▼  only now
                      ┌──────────────┐
                      │ evaluation   │  (oferta / auto-pipeline)
                      └──────────────┘
```

**Dedup:** the engine already drops any ingest result already present in tracker / pipeline / `data/scan-history.tsv` by normalized URL — we get this free and add nothing. A listing confirmed dead is recorded `skipped_expired` by `check-liveness.mjs` so it stops resurfacing.

**Invariant preserved:** imported listings never skip the Aggregator-Confirm-at-Employer rule or `check-liveness.mjs`. The design adds a *source*, not a *shortcut*.

---

## 3. Apply-review queue (Step 3)

### 3.1 Principle

A queue of **prefilled, ready-to-review** applications surfaced in `web/`. The core already prefills and **never presses Submit** (`apply` mode + `web/src/lib/apply/*`, `humanInTheLoop`, no auto-submit plugin hook exists). The queue is a **view + state store over work the user still drives** — it must not add an automated submit path, and it must respect the headless-permission constraints in `CLAUDE.md` (no blanket auto-approve; `pdf`-style read-only where the harness writes).

### 3.2 Data model

Store: `data/apply-queue/queue.json` (user-layer, preserved), accessed only through `web/src/lib/apply-queue-store.mjs` (mirrors the locking discipline of `scheduled-jobs-store.mjs`: `withResourceLock`, atomic write, id-safety).

```
QueueItem {
  id:            string          // stable, derived from pipeline entry / report #
  reportNum:     string | null
  company:       string
  role:          string
  url:           string          // canonical EMPLOYER url (post-confirmation)
  atsVendor:     string | null   // greenhouse | lever | ashby | workday | ...
  state:         QueueState      // see state machine
  prefill:       { fieldsReady: int, fieldsTotal: int, knockoutFlags: string[] }
  artifacts:     { cvPath?: string, coverPath?: string }   // local paths, never links
  createdAt:     ISO8601
  updatedAt:     ISO8601
  history:       { at: ISO8601, from: QueueState, to: QueueState }[]
}
```

### 3.3 State machine

```
          ASCII — Apply-queue state machine  (NO auto-submit edge exists)

  (pipeline entry, score ≥ threshold, employer-confirmed, live)
                         │
                         ▼
                   ┌───────────┐   prefill run (Playwright, api/apply/prefill)
                   │  QUEUED   │──────────────────────────────┐
                   └─────┬─────┘                              ▼
                         │                              ┌────────────┐
        knockout fail /  │                              │ PREFILLED  │  fields filled,
        hard mismatch    │                              └─────┬──────┘  form OPEN in browser
                         ▼                                    │
                   ┌───────────┐                              │ user reviews in web
                   │ BLOCKED   │                              ▼
                   │ (reason)  │                        ┌──────────────┐
                   └─────┬─────┘        user edits ◄────│ NEEDS_REVIEW │
                         │              answers         └──────┬───────┘
                         │ user resolves                       │
                         └─────────────────────────────────────┤
                                                                │  ⚑ USER clicks Submit
                                                                │     in the real browser
                                                                ▼     (agent NEVER does)
                                                        ┌──────────────┐
                                                        │ SUBMITTED*   │  *user-attested only
                                                        └──────┬───────┘
                                                               │ /outcome, set-status.mjs
                                                               ▼
                                                        ┌──────────────┐
                                                        │   APPLIED    │ (tracker = Applied)
                                                        └──────────────┘

   Any state ──user discards──▶ DISCARDED        (→ tracker Discarded)
```

- **The `NEEDS_REVIEW → SUBMITTED` transition is triggered by the user attesting they submitted**, never by the agent. There is deliberately no `PREFILLED → SUBMITTED` automated edge. `SUBMITTED` is a *claim the user makes*, consistent with "Stop before Submit" in `AGENTS.md` / `CLAUDE.md`.
- `BLOCKED` carries the knock-out reasons from the existing pre-scan so the user sees *why* before investing review time.

### 3.4 API shape (web, spawn-bridged)

| Route | Method | Behaviour | Writes |
|---|---|---|---|
| `api/apply-queue` | `GET` | list queue (optionally `?state=`) | — (read `queue.json`) |
| `api/apply-queue` | `POST` | enqueue a pipeline entry (id/reportNum) | `queue.json` |
| `api/apply-queue/[id]` | `PATCH` | transition state (validated against the machine) | `queue.json` (+ `history`) |
| `api/apply-queue/[id]/prefill` | `POST` | run prefill — **reuses existing** `api/apply/prefill` + `api/apply/session` | opens browser; no submit |

State transitions are validated server-side in `apply-queue-store.mjs` against the machine above; an illegal transition (e.g. `QUEUED → SUBMITTED`) is rejected. `SUBMITTED` additionally requires a user-attestation flag in the PATCH body. Prefill **reuses** the existing apply routes — we add a queue over them, not a second apply engine.

---

## 4. Gap-bridging (Step 4) + daily-activity dashboard (Step 5)

### 4.1 Gap-bridging data contract

Layers **on top of** the existing analysis — never fabricates skills (Source-of-Truth Boundary):

```
Input  (read-only, existing):
  jd-skill-gap.mjs  → { existing[], supportedByResume[], gap[] }   per report
  upskill.mjs       → weighted skill-gap map across tracked reports
  cv.md / config/profile.yml / modes/_profile.md  → the ONLY source of what the candidate has

New CLI: gap-plan.mjs  (fork-local, declared in config/local-paths.txt)
  node gap-plan.mjs --report N --json
Output (user-layer): data/gap-plans/{NNN}-{company-slug}.md   +  --json for the web route
  GapPlan {
    reportNum, generatedAt,
    gaps: [{ skill, weight, evidenceInCv: bool }],   // weight from upskill.mjs
    suggestions: [{ skill, kind: 'course'|'project'|'reading', note }]   // NON-fabricating
  }
```

**No-fabrication rule (hard):** `gap-plan.mjs` labels each gap as *missing* vs *present-but-thin* using only in-scope files. It **suggests how to close a gap** (a course, a portfolio project, reading) but **never writes a claimed skill into `cv.md` or `config/profile.yml`**. Any CV change still flows through the existing confirm-before-write modes (`add` / `expand`). A suggestion is advice, not a fact.

### 4.2 Daily-activity event log contract

The dashboard needs a single, cheap-to-read feed of "what the agents did today." Define an **append-only NDJSON event log**:

```
Path:   data/activity/YYYY-MM-DD.ndjson      (one file per local day; user-layer)
Writer: lib/activity-log.mjs  →  appendEvent(event)   (atomic append, best-effort, never throws into caller)
Reader: web/src/lib/activity-log.mjs  →  readDay(date), readRange(from,to)

ActivityEvent {
  ts:      ISO8601,
  source:  'scheduled-scan' | 'email-import' | 'apply-queue' | 'gap-plan' | 'evaluation',
  kind:    string,          // e.g. 'scan.completed', 'listing.imported', 'apply.prefilled'
  summary: string,          // one line, human-facing
  ref:     { reportNum?, queueId?, url? }   // url for provenance only
}
```

- **Emitters** (additive, no core edits): `scheduled-jobs-runner.mjs` can emit via the new `lib/activity-log.mjs` *called from the fork-local wrapper*, not by editing the runner — OR, if the runner is fork-owned enough to extend, a single additive `appendEvent` call. Since `web/scripts/scheduled-jobs-runner.mjs` is **outside the updater** (web/ not in SYSTEM_PATHS), a one-line additive emit there is fork-safe. The email-import plugin and apply-queue store emit on their own transitions.
- **Reader:** `api/activity/route.ts` (`GET ?date=` / `?from=&to=`) reads the NDJSON day files; the dashboard renders a reverse-chronological feed + per-day counts.
- **Why NDJSON, not a DB:** append-only, crash-safe, zero-dependency, trivially diffable, matches the repo's TSV/markdown local-first posture. Per-day files cap read cost and let old days be deleted freely. ADR-worthy (hard to reverse, has a real alternative in SQLite) — recorded as **ADR candidate A** below.

```
        ASCII — activity feed fan-in

  scheduled-jobs-runner.mjs ─┐
  mail-alerts plugin ────────┤  appendEvent()
  apply-queue-store.mjs ─────┼──────────────▶ data/activity/YYYY-MM-DD.ndjson
  gap-plan.mjs ──────────────┤                        │ readDay / readRange
  evaluation (opt.) ─────────┘                        ▼
                                          web api/activity → /activity page
```

---

## 5. Test strategy (Node + `test-all.mjs`, not Go)

This repo's CI runs `test-all.mjs` (Node test runner, `.mjs`), gated by GitHub Actions. New tests are additive `tests/*.test.mjs` + `web/` tests. Coverage targets the four seams:

1. **Fork-safety invariant test (the keystone).** `tests/fork-safety.test.mjs`: import `SYSTEM_PATHS` from `lib/update-manifest.mjs` and assert **none** of the new feature paths (`plugins.local/mail-alerts/…`, `gap-plan.mjs`, `data/apply-queue/…`, `data/activity/…`, the new web routes) appear in it. Also assert `gap-plan.mjs` is declared in `config/local-paths.txt`. This mechanically enforces §1.2 and fails CI the moment someone edits an upstream file into the feature set.
2. **Email parsers.** Per-sender fixture tests on saved `.eml` samples (LinkedIn / Indeed / Naukri / ZipRecruiter / unknown): `detectSender` + `parse` → expected `RawListing[]`. Include a **prompt-injection fixture** (email body with "ignore your instructions…") asserting the parser extracts only structured fields and surfaces the body as an anomaly, never as an instruction. Fixtures use *synthetic* emails committed under `test-fixtures/`, never real inbox data.
3. **Ingestion routing.** Integration test: a drop-folder import lands an UNCONFIRMED pipeline entry, is deduped on a second run via `scan-history.tsv`, and never auto-evaluates. Reuse the existing mail-drop test harness pattern.
4. **Apply-queue state machine.** Unit-test `apply-queue-store.mjs`: every legal transition accepted, every illegal one (esp. any path to `SUBMITTED` without user attestation) rejected. Assert there is no code path that submits.
5. **Activity log.** `appendEvent` is atomic/crash-safe (concurrent writes don't corrupt a day file) and never throws into its caller; `readRange` returns events in order.
6. **Gap-plan no-fabrication.** Assert `gap-plan.mjs` never writes to `cv.md` / `config/profile.yml` (run it against a fixture profile; diff those files = unchanged).
7. **Web routes.** Light route tests (existing `web/` test conventions) for `api/apply-queue`, `api/activity`, `api/gap-plan` happy-path + validation.

All tests are Node/`.mjs`; wire new root tests into `test-all.mjs`'s discovery and web tests into the web test script. No new CI job is required beyond what `test-all.mjs` already runs.

---

## 6. Risks & upstream-edit flags (with options)

| # | Risk | Severity | Options |
|---|---|---|---|
| **R1** | `web/` is outside the updater, so upstream web fixes never auto-arrive; the fork's web diverges. | Medium | **(a)** Accept divergence — treat `web/` as fork-owned (status quo today). **(b)** Periodic manual `git merge upstream/main -- web/`; our new files are in new dirs so merges stay clean. Recommend (a) for v1, revisit if upstream web changes become valuable. |
| **R2** | Linking new pages into web nav may require editing an existing web file. | Low | **(a)** If nav is data-driven, one additive entry (no conflict). **(b)** Ship pages as URL-reachable only in v1 (zero-touch). Recommend (a) if nav config exists, else (b). |
| **R3** | A parser needing a new npm dep edits `web/` or root `package.json`. | Low | Prefer zero new deps (Node built-ins + existing `js-yaml`). If unavoidable, additive `dependencies` line — low merge risk. |
| **R4** | `gap-plan.mjs` at repo root could collide with a future upstream file of the same name. | Low | Declare in `config/local-paths.txt` (updater refuses to overwrite a declared fork path). Option: nest it under `plugins.local/` instead to guarantee no root collision — flagged for owner preference. |
| **R5** | Someone "fixes" a feature by editing an upstream System-Layer file (e.g. `scan.mjs`, `merge-tracker.mjs`). | **High if it happens** | The §5.1 fork-safety test fails CI on any such edit. This is the guardrail that makes the invariant real rather than aspirational. |

**No unavoidable System-Layer edit exists for any of the four features.** The only edits are to fork-owned registration/config files (`config/local-paths.txt`, `config/plugins.yml`) and possibly web nav — all additive, all preserved by the updater.

---

## 7. ADR candidates (for the owner to confirm, not pre-decided)

- **ADR-A: NDJSON per-day activity log vs SQLite.** Hard to reverse (consumers depend on the format), surprising later ("why not a DB?"), real trade-off (queryability vs zero-dependency local-first). Recommend NDJSON; record the reasoning.
- **ADR-B: `gap-plan.mjs` at root vs inside `plugins.local/`.** Reversible-ish but worth recording given R4.

---

## 8. Hand-off to implementers

Build order (each is an independently shippable sub-issue; slice by user-visible behaviour, not by layer):

1. **`mail-alerts` ingest plugin** (multi-sender parser registry + drop folder + Gmail reuse) → Backend. Delivers: new postings from Indeed/Naukri/ZipRecruiter alerts land UNCONFIRMED in the pipeline.
2. **Apply-review queue** (`apply-queue-store.mjs` + routes + `/apply-queue` page) → Backend + Frontend. Delivers: a reviewable queue of prefilled apps; user submits, agent never does.
3. **Gap-bridging** (`gap-plan.mjs` + `/gap-plan` route) → Backend. Delivers: a plan to close each gap, no fabricated skills.
4. **Daily-activity dashboard** (`lib/activity-log.mjs` emitters + `api/activity` + `/activity` page) → Backend + Frontend. Delivers: a per-day feed of what the agents did.
5. **Fork-safety CI test** (§5.1) → first, so every later PR is guarded.

Each implementer works from the interfaces above without a follow-up to me; interface questions that change the contract come back to this issue.
