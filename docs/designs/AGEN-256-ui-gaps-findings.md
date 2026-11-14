# AGEN-256 — UI gaps: root cause + locked contracts (Stage-4 design)

Parent: AGEN-244 "Gaps in the current system on UI". This is the design/investigation
deliverable. No production code here — reproduction, confirmed file:line pointers, and
contracts the Stage-5 implementation sub-issues build against without re-deciding.

All pointers verified against the worktree on 2026-11-14.

---

## Item A — Gap 4 (highest priority): Discover (free) returned tech/sales for HR "Roles to find"

### Verdict

**The deterministic matching chain is CORRECT. The defect is upstream, in the client
assembly of the POST body: `positive` reached `/api/explore` empty, so the scanner ran in
match-everything mode and surfaced the ATS directory's dominant tech/sales postings.** This
is a real bug (not a by-design company-discovery path), and it is NOT in the scanner, the
serializer, the `title_filter`/`title_filter_full` key, or the web ingest.

### What I proved (reproduction, runs in plain `node`, no deps)

`docs/designs/AGEN-256-repro-gap4.mjs` exercises the REAL modules end-to-end:
`clean-chips.mjs` → `explore-expand.mjs` (`expandFiltersForScan`) → `portals-serialize.mjs`
(`serializePortals`) → `title-keywords.mjs` (`buildTitleFilter`). Output:

```
--- serialized temp portals ---
title_filter:
  positive:
    - "Talent Management"
    - "Succession Planning"
    - "Leadership Development"
--- title filter results (HR positives) ---
rejct  Senior Software Engineer
rejct  Account Executive - Enterprise Sales
rejct  Data Scientist
PASS   VP, Talent Management
PASS   Director of Leadership Development
PASS   Succession Planning Lead
--- control: empty positive ---
PASS   Senior Software Engineer      <- every tech/sales title matches
PASS   Account Executive - Enterprise Sales
PASS   Data Scientist
```

Given the HR keywords, the chain rejects tech/sales and passes HR. The ONLY way tech/sales
come back is the control case: `positive` arrives empty.

### The mechanism (confirmed file:line)

- `title-keywords.mjs` `buildTitleFilter`: `hasPositive = positive.length === 0 || positive.some(m => m(lower))`. **Empty positive list = match everything.** This is the gate.
- `web/src/app/api/explore/route.ts:28` — `const filters = parseExplorePatch(body, DEFAULT_FILTERS);`
- `web/src/lib/explore.ts:234` — `parseExplorePatch`: `if (raw[key] === undefined) continue;` so a missing/empty `body.positive` leaves `DEFAULT_FILTERS.positive` which is `[]` (`explore.ts:99`).
- `web/src/lib/core/portals.ts:39-62` `writeTempPortals` → `expandFiltersForScan` (additive, preserves chips) → `serializePortals`. **Confirmed: it emits `title_filter.positive` verbatim from `f.positive`; it does NOT re-seed from profile.** So whatever `positive` the route computed is exactly what the scanner sees.
- `web/src/components/explore/explore-provider.tsx` `discover()` POSTs `filtersRef.current` (the full `ExploreFilters`), so `positive` is always *present* in the body — therefore an empty `positive` means the provider's own filter STATE was empty at click time.

### Corrected pointers from the ticket

- **`title_filter` vs `title_filter_full` — RULED OUT.** `serializePortals` emits `title_filter`; `scan-ats-full.mjs` `resolveTitleFilterConfig` returns `config.title_filter_full ?? config.title_filter`, so it reads `title_filter`. No key mismatch.
- **Ingest surfacing unfiltered offers — RULED OUT.** `web/src/lib/core/scan.ts` `ingestJsonOffer` (~:76-103) only annotates offers the scanner ALREADY EMITTED (it sets `matchedKeyword`/`fit` and dedups). The scanner emits only offers that pass `passesFilters`/`listingMayMatch` (`scan-ats-full.mjs` ~:1188-1189). Ingest cannot resurrect a title the scanner filtered out.
- **"All weak fit" is corroboration, not a second bug.** `scan.ts` `fit` is computed by `fitField(title, loadProfileTargets())` (scan.ts:58-74) against the user's **`config/profile.yml` target roles**, NOT the search chips. The user's profile targets are HR, so genuinely-tech postings score "weak". That the returned postings score weak against an HR profile independently confirms the postings really are off-target — i.e. the title filter did not apply. Stage-5 must NOT "fix" the weak-fit label; it is behaving correctly.

### Where the bug lives

Client-side, in assembling `filters.positive` before `discover()` reads `filtersRef.current`.
Most likely: the "Roles to find" draft was never flushed into `filters.positive` (relying on
`filter-builder.tsx` onBlur at line 115 to commit before the Discover click's onClick reads
state — a focus/blur-ordering race), or a seed/`touched` path left `positive` empty.

### Reproduction handoff for Stage-5 Backend/Frontend (TDD)

1. **Server boundary test — EXPECTED PASS** (proves the correct half, locks it against regression):
   call `writeTempPortals({ positive: ["Talent Management","Succession Planning","Leadership Development"], negative:[], allow:[], block:[], blockHard:[], alwaysAllow:[], sinceDays:7, ats:[...], limitPerAts:150 })`, parse the written temp YAML, assert `title_filter.positive` deep-equals the HR keywords, then assert `buildTitleFilter(resolveTitleFilterConfig(parsed))("Senior Software Engineer") === false` and `(...)("VP, Talent Management") === true`. The committed `AGEN-256-repro-gap4.mjs` already demonstrates this with the real modules.
2. **Client boundary test — the FAILING test to write:** render the Explorer, type `Talent Management` into the field labelled "Roles to find", click "Discover (free)", intercept `fetch('/api/explore')`, and assert the request body's `positive` contains `"Talent Management"`. Expected to FAIL today. Candidate fix to verify green: in `explore-provider.tsx` `discover()`, flush any pending KeywordField draft into `filters.positive` before reading `filtersRef.current`, rather than relying on blur ordering.
3. Instrument points: `explore-provider.tsx` `discover()`; `filter-builder.tsx` KeywordField `commit`/onBlur (68-73, 115) and the "Roles to find" binding (190-191).

---

## Item B — Gap 3: "Remote" vs "Remote-anywhere"

### Verdict

**Mostly handled already; no scanner/location-engine change needed. The only defensible
change is a UI label + one-line helper text.** Worldwide-remote semantics are already
reachable today.

### Current behavior end-to-end (confirmed)

- `web/src/lib/explore.ts:62-69` — `WorkSetup = "remote"|"hybrid"|"onsite"`, label `remote: "Remote"`.
- `web/src/lib/explore-expand.mjs:30-34` — selecting work-setup **Remote** adds BOTH `"Remote"` and `"Worldwide"` to the location allow-list (`WORK_SETUP_ALLOW.remote = ["Remote","Worldwide"]`).
- `scan.mjs` `WORLDWIDE_LOCATION_LABELS` = `{worldwide, anywhere in the world, remote (worldwide)}` — bare `"Remote"` is deliberately NOT in it. `REMOTE_TITLE_RE` + `titleSignalsRemote()` + `remote_title_fallback` (default on) still catch titles that themselves say remote.
- AGENTS.md onboarding already documents: a posting labelled only "Remote" (no country) will NOT match a country allow-list, and "Remote"/"Hybrid" are refused as location entries because they would admit every country.

So selecting "Remote" today already appends a `Worldwide` allow entry, which is exactly the
worldwide-remote match the user wants; the `Remote` entry it also appends is a harmless
substring aid that does not, by itself, admit every country the way a bare location-filter
"Remote" would.

### Locked decision for Stage-5

- **Do NOT** add bare `"Remote"` as an unconditional location match anywhere (hard constraint — it admits every country and breaks the allow-list).
- Minimal change, if any: rename the UI label from "Remote" to **"Remote (anywhere)"** and add helper text: "Matches worldwide-remote postings. A posting tagged only 'Remote' with a specific country still needs that country in Locations." No change to `WORK_SETUP_ALLOW`, `scan.mjs`, or the location precedence block.
- Honest answer: this item is "**UI label only — no code-behavior change needed**."

---

## Item C — Gap 2: run records must say WHICH roles, not just how many

### Verdict

Backward-compatible additive field on `JobRun`. The runner already parses the full-scan JSON
that carries the titles — it just discards everything but the count.

### Confirmed pointers

- `web/src/lib/scheduled-jobs.ts:35-45` — `JobRun` has only `rolesFound?: number`.
- `web/scripts/scheduled-jobs-runner.mjs:134-145` — `extractRolesFound(engine, stdout)` JSON-parses the full-scan stdout and returns only `Number(result.postingsKept)`.
- `web/src/lib/core/scan.ts:150-161` — the `--json` stdout `ScanJson` already includes `offers?: JsonOffer[]`, where `JsonOffer = { company?, title?, url?, location?, postedAt?, source? }`. The role identities are already in the parsed object.
- `web/src/components/scheduled-scans/run-history-drawer.tsx:88-89` renders `{run.rolesFound} roles found` guarded by `typeof run.rolesFound === "number"`.

### Locked contract

Extend `JobRun` (backward compatible — field optional, old `data/scheduled-jobs.json` records
simply lack it):

```ts
export type JobRunRole = {
  title: string;        // required
  company?: string;
  url?: string;         // the dedup/stable key when present
};

export type JobRun = {
  // ...existing fields unchanged...
  rolesFound?: number;              // KEEP — the count, still authoritative
  roles?: JobRunRole[];             // NEW — identities, newest run only; may be capped
};
```

- **Runner extraction** (`extractRolesFound` → add a sibling `extractRoles(engine, stdout)` or widen the return): for `engine === "full"`, map `result.offers` → `{ title, company, url }`, keep `rolesFound = result.postingsKept` as today. For `engine === "portals"` (human-stdout, no JSON `offers`), leave `roles` undefined — the count stays, identities are absent. Cap the stored array (e.g. first 50) so a 300-role sweep does not bloat the JSON store.
- **Rendering old records:** `run-history-drawer.tsx` keeps the `{rolesFound} roles found` line. When `roles?.length`, render the list/expander beneath it; when absent (old records, or portals-engine runs), render exactly today's count-only line. No migration of `data/scheduled-jobs.json` required.
- Keep it small: no new store file, no schema version bump — one optional array on the existing run record.

---

## Item D — Gap 5: retain the applied resume version + stable link

### Verdict

**The apply-time pointer must be written to a user-layer file at apply time, because the two
places the version lives today are both non-durable.** Define the storage contract; do not
implement.

### Why today's state loses the version (confirmed)

- `output/` is gitignored and transient.
- `data/pdf-index.tsv` (written by `generate-pdf.mjs` `updatePDFManifest`, ~:1705-1735) is keyed by `(reportNum, kind)` with **supersede-on-regenerate** semantics ("a regenerated document supersedes its own stale entry") and is itself **gitignored**. So it points at the LATEST render for a report, not the version used at a specific application. Regenerating the CV after applying silently overwrites the pointer.
- `web/src/lib/apply/cv.ts` `resolveSessionCv` (:71) → `resolveTailoredCv` (:21) resolves the CV by report-number → `pdfPathStatusForReport`, else by company token match (`cv-match.mjs` `matchesTailoredCv`, `cv-` prefix contract, :31-51). This resolves "the current tailored CV for this report/company", again NOT a frozen apply-time snapshot.
- The ONLY durable, byte-verified copy is created later by `outcome.mjs` — `data/outcomes/{num}_{company}_{role}/submitted_cv.{pdf,md,html}` (sha256-verified). But that only exists once the user records an outcome; between applying and the outcome there is no durable pointer, and if the CV was regenerated in between, the outcome archive can capture the wrong version.

### Locked storage contract for Stage-5

1. **Snapshot at apply time, into a user-layer file.** When the apply flow confirms (the user applied), copy the exact resolved CV (from `resolveSessionCv`) into a durable, non-gitignored, user-layer location: `data/applied-cvs/{report}-{YYYY-MM-DD}-{sha256[0:12]}.pdf` (and `.html` if present). `data/` is user-layer (NEVER auto-overwritten by system updates), satisfying the Data Contract. The content-hash in the name makes it immutable: a later regeneration writes a NEW file, it cannot clobber the applied one.
2. **Record the pointer in a user-layer index, not a derived file.** Append one row to a new append-only `data/applied-cvs.tsv` (user-layer, sibling of `data/pdf-index.tsv` but durable and never superseded):
   `report \t applied_date \t cv_path \t sha256 \t source_report_pdf`.
   Append-only + content-addressed = an application's version is frozen the moment it is recorded; nothing rewrites history. This is Source-of-Truth-compliant: it is a pointer to a user-generated artifact, it introduces no factual claim about the candidate, and it never edits `cv.md`/profile.
3. **Stable link in the web.** A new read-only route (e.g. `/api/applied-cv?report=N` or `?sha=...`) resolves the row in `data/applied-cvs.tsv` and streams the frozen file. The tracker/report UI links to it as "CV used to apply (DD MMM)". Because the row is keyed by report + sha and the file is content-addressed, the link is stable across regenerations and across machines that have the `data/` layer.
4. **Relationship to `outcome.mjs`:** at outcome time, prefer the frozen `data/applied-cvs/` file for the matching report over re-resolving `output/`, so the outcome archive captures the version actually sent, not whatever the latest render happens to be. (Implementation detail for Stage-5; the contract is: `outcome.mjs` reads the applied-cvs index first.)

Honest note: a lighter alternative is a tracker Notes marker (`applied-cv: data/applied-cvs/...`),
but a dedicated append-only TSV + content-addressed file is cleaner to query, immune to Notes
free-text drift, and matches the existing `data/*.tsv` user-layer pattern. Recommend the TSV.

---

## Summary for Stage-5

| Item | Outcome | Code change in Stage-5? |
|------|---------|-------------------------|
| A | Client POST assembles `positive` empty; scanner/serializer/ingest/key all correct (proven). | Yes — frontend fix + 2 boundary tests (1 passing guard, 1 failing repro). |
| B | Worldwide-remote already reachable via `WORK_SETUP_ALLOW.remote=["Remote","Worldwide"]`. | UI label + helper text only. Never add bare "Remote" as a location match. |
| C | `JobRun.roles?: {title,company?,url?}[]`; runner maps `--json` `offers`; old records render count-only. | Yes — small additive schema + runner + drawer. |
| D | Freeze applied CV into content-addressed `data/applied-cvs/` + append-only `data/applied-cvs.tsv`; stable web route. | Yes — storage contract defined, implementation is Stage-5. |
