# Approval Queue — Data Model, Taxonomy & Provenance Ledger

**Issue:** AGEN-202 (architecture stage of AGEN-15). Backend and frontend stages consume this.
**Principle:** extend the existing agent-inbox; do not fork or rebuild. Nothing ever auto-submits.

## 1. What this is

Today the agent stops *ad-hoc* at each decision that leaves the machine or changes the
user's facts. Unattended runs even emit ephemeral `needs_confirmation: <variant>` strings
at end-of-turn (seen in `apply`, `oferta`, `cover`, `add`, `intake`, `expand`) that vanish
when the turn ends. This design turns those scattered stops into **one durable, categorized,
prioritized queue** the user clears when they have time — the human-in-the-loop control
surface for hands-off discovery.

It is the tracker ↔ status-log relationship applied to approvals:

| Role | Live state (human-readable) | Append-only history |
|------|-----------------------------|---------------------|
| Applications | `data/applications.md` | `data/status-log.tsv` |
| **Approvals** | **`data/agent-inbox.md`** (extended) | **`data/approval-log.tsv`** (new) |

The inbox stays the single queue file (markdown checklist, stable file-position numbers,
append-only, `writeFileAtomic` + `withPipelineLock`, exclusive-create, `--expect` guards).
The ledger is the durable record of *what crossed a boundary and when the user said yes* —
and the inbox line is a projection that can be rebuilt from it.

## 2. Taxonomy (the six categories)

Canonical, closed vocabulary lives in **`templates/approval-categories.yml`** (authored in this
change), consumed by the writer (`agent-inbox.mjs`) and the reader (dashboard/web) exactly as
`templates/states.yml` is shared. A category id absent from that file is refused on write and
skipped-with-warning on read.

| id | `[LABEL]` | Approving it means | Sink (crosses…) | Batchable | Producers |
|----|-----------|--------------------|-----------------|-----------|-----------|
| `submit` | SUBMIT | "A complete application is ready; I will submit it myself." | `form-submit` → employer | **NO (invariant)** | `apply` |
| `borderline` | BORDERLINE | "Pursue this grey-zone posting, or discard." | `none` (decision gate) | yes | `oferta`, `auto-pipeline`, `triage` |
| `message` | MESSAGE | "This outbound text is send-ready; I'll send it myself." | `email` / `linkedin` → a person | yes | `cover`, `email`, `contacto` |
| `resume` | RESUME | "This tailored CV is accurate; I'll use it." | `file` (attach/upload) | yes | `pdf`, `latex`, `text` |
| `profile` | PROFILE | "Write this fact into my source-of-truth files." | `file` (my facts) | yes | `add`, `intake`, `expand` |
| `targeting` | TARGETING | "Apply this change to what my search targets." | `file` (scoring/scan config) | yes | `titles`, `discover`, `patterns`, `retro` |

**Exact rule per category** (the boundary that separates it from its neighbours):

- **SUBMIT** — the *only* category whose approval is an irreversible **outward action the user
  alone performs**. Distinct from RESUME/MESSAGE (which are *artifacts to review*): SUBMIT is
  *the act of submitting*. Producer `apply` persists filled answers into the posting's report
  (`## Application Answers`, keyed by report number via `find.mjs`) and stops before Submit.
- **BORDERLINE** — a **go/no-go decision, not an artifact**: fit at the ~4.0/5 Ethical-Use
  boundary, or a Block G legitimacy/risk flag. Approving (`pursue`) may spawn downstream
  RESUME/MESSAGE/SUBMIT items; `discard` closes it. Carries score + reason + risk flag. From
  `oferta` (report number via `reserve-report-num.mjs`).
- **MESSAGE** — generated **prose leaving the machine to a person**: cover letter
  (`output/{company}-{role}-cover.pdf`, linked to the report's `## Cover Letter Draft`),
  application email (`email`, draft-in-chat, no file by default), or LinkedIn outreach
  (`contacto`, within the tier char limit, optional `data/contacts.tsv` row). Draft-only; the
  system never sends. Not SUBMIT: SUBMIT is a form action, MESSAGE is content — one application
  can carry both.
- **RESUME** — a **CV tailored to one posting** awaiting a fact-review before use. From `pdf`:
  `output/cv-{candidate}[-{report}]-{company}-{date}.pdf` (optional `-ats` variant) or the
  bundle `cv/tailored/v001/{cv.html,cv.pdf,changes.md}` with `decision/reuse.json`. No network
  egress by itself, but it reshapes the candidate's facts to a JD, so it is fact-gated.
- **PROFILE** — a proposed change to the user's **facts**: `cv.md`, `config/profile.yml`,
  `article-digest.md`, `data/career-profile.yml`. From `add`/`expand` (via `add-entry.mjs`) and
  `intake` (`config/profile.yml`/`cv.md`/`modes/_profile.md`, fingerprinted in
  `data/intake-state.json`). Gated by the Source-of-Truth Boundary; **must carry the claim's
  source provenance** (document / user-stated date / `derived-unverified`), honouring the
  DATA_CONTRACT convention.
- **TARGETING** — a proposed change to **who/what the search targets**: archetypes/North-Star in
  `modes/_profile.md`, or `portals.yml` (keywords, locations, companies, filters). Gated because
  it silently changes every future score and scan.

**GENERAL lane (not a seventh category).** Legacy untagged items ("evaluate this URL") parse as
GENERAL — a free *intent* for the agent to run, no sink, no ledger requirement. The queue and the
original inbox share one file; `list` groups GENERAL separately. This is what keeps every existing
test and the original feature green.

## 3. The SUBMIT invariant — encoded, not conventional

> **CRITICAL (from the issue): SUBMIT is never batch-approvable; Approve means "I will submit it
> myself," never auto-submit. Encode as a data-model invariant.**

Three machine-checkable invariants (in `lib/approval-schema.mjs`, authored as a stub in this change):

1. **`batchable` is derived from the category, never a per-item field.** `isBatchable('submit')`
   is `false` by construction, so no code path can emit a batchable SUBMIT item.
2. **A multi-select / "approve selected" operation refuses if it touches SUBMIT.**
   `assertBatchApprovable(items)` throws loudly (the `--expect`-guard spirit) listing the SUBMIT ids.
3. **An approving ledger event requires `actor=user`, and SUBMIT may only be approved via
   `self-submitted`** (never `approved`, never an automated sink). `assertLedgerRowLegal(row)`
   throws on a machine-made approval. The agent may write `queued`/`superseded`; it may *never*
   write `approved`/`edited`/`self-submitted`/`pursue`. SUBMIT has **no** automated sink action
   anywhere in the schema — its only approving resolution is the user attesting they pressed Submit.

A ledger containing an agent-actored approval is a contract violation the backend test suite must reject.

## 4. Data model

### 4.1 Inbox line (live queue projection)

The leading `- [ ] <stamp> — ` prefix is **byte-identical to a legacy item**, so the existing
`agent-inbox.mjs` regex parses it unchanged (existing tests stay green). The category tag + minimal
meta live inside the existing free-text field:

```
- [ ] 2026-11-11 14:30 — [SUBMIT] Acme — Senior ML Engineer {id=apr_1a2b3c4d ref=042 sink=form-submit}
- [x] 2026-11-11 14:31 — [RESUME] Globex — Staff MLE {id=apr_9f8e7d6c ref=output/cv-...pdf sink=file} → result: approved
```

- `id` (`apr_<8 hex>`) is the stable join key to the ledger, minted once at queue time
  (collision-resistant, no central counter → parallel-safe, avoids the #749 race).
- The inbox stays lean (category, headline, id, ref, sink). Full history + sha + source
  provenance live in the ledger. Rationale: a `{…}` block inside a hand-editable checklist line is
  fragile; keep the durable record in the TSV and treat the line as rebuildable.
- Disposition (pending `[ ]` / resolved `[x]`) stays binary to preserve the existing parse; the
  *which* disposition (approved/edited/rejected/self-submitted/pursue/discard) is the `→ result:`
  suffix **and** the ledger row.

`ApprovalItem` / `LedgerRow` typedefs: see `lib/approval-schema.mjs`.

### 4.2 Provenance ledger `data/approval-log.tsv` (append-only)

Mirrors `status-log.tsv`: sibling of the live file, append-only, closed vocabulary, `-` sentinel,
newline-safe atomic append via **`tracker-utils.appendLedgerRows`** under `withPipelineLock`. One
row per transition.

```
id            ts                 event          category    producer  sink         ref                    sha        actor  note
apr_1a2b3c4d  2026-11-11 14:30   queued         submit      apply     form-submit  042                    9c1f…      agent  filled 7 fields
apr_1a2b3c4d  2026-11-11 15:02   self-submitted submit      apply     form-submit  042                    9c1f…      user   -
apr_9f8e7d6c  2026-11-11 14:31   queued         resume      pdf       file         output/cv-…pdf         3ab0…      agent  -
apr_9f8e7d6c  2026-11-11 14:40   approved       resume      pdf       file         output/cv-…pdf         3ab0…      user   -
```

- `event` ∈ `{queued, approved, edited, rejected, deferred, pursue, discard, self-submitted, superseded}` (closed set, like `VALID_SOURCES`).
- `actor` ∈ `{user, agent, dashboard, cron}`. **Approving events are always `user`** (invariant 3).
- `sha` = sha256 of the exact bytes approved (scan-at-sink discipline — detects drift if the
  artifact changes after approval; empty `-` for BORDERLINE). Re-approval required if sha changes before use.
- This is the audit trail the user wanted: *what left the machine / changed my facts, and when I said yes.*

## 5. Priority ordering — reuse `lib/inbox-rank.mjs`, no new ranker

`orderApprovals(items, profile)` (in `agent-inbox.mjs`, or a thin `lib/approval-order.mjs` that
*calls* inbox-rank):

1. Pending before resolved (resolved hidden unless `--all`, unchanged).
2. **Category weight** — a static lookup from `approval-categories.yml` (`weight`), NOT a computed
   score: SUBMIT(100) > BORDERLINE(90) > MESSAGE(70) > RESUME(60) > PROFILE(40) > TARGETING(30);
   GENERAL(50). This is a tier table (like `dashboard_group`), not a ranker — tunable.
3. **Within a tier**, posting-linked items order by `scorePosting(...).score` via the existing
   `orderInbox` / `rankOffers` from `lib/inbox-rank.mjs`. No scoring math is added anywhere.
4. Tie-break: recency, then file position (stable).

## 6. Module layout (where new code lives)

| File | New/changed | Responsibility |
|------|-------------|----------------|
| `templates/approval-categories.yml` | **new (this change)** | Canonical taxonomy + per-category invariants; shared writer/reader vocabulary. |
| `lib/approval-schema.mjs` | **new stub (this change)** | Category table loader, id minter, inbox-line & ledger (de)serializers, the 3 invariant guards. Pure. |
| `lib/approval-log.mjs` | new (backend) | Append-only ledger writer/reader; mirrors `set-status.mjs`→`status-log.tsv`; validates closed vocab + invariant 3. |
| `agent-inbox.mjs` | extend (backend) | `add --category --ref --sink`; `list --category --pending` (grouped, ordered via inbox-rank); `approve`/`reject`/`edit` dispositions that write the ledger; SUBMIT batch-guard. All existing commands/flags untouched. |
| `lib/inbox-rank.mjs` | **unchanged** | Ordering is delegated to it; never duplicated. |
| producers (`apply`, `pdf`, `cover`, `email`, `contacto`, `add`, `intake`, `expand`, `oferta`) | wire (backend, one follow-up each) | Replace the ephemeral `needs_confirmation:` end-states with a durable `agent-inbox add --category …`. |
| dashboard / web | read (frontend) | Render categories from `approval-categories.yml`; show the queue grouped + ordered; clear items (respecting the SUBMIT invariant). |

## 7. Change sequence (for the implementer)

1. `templates/approval-categories.yml` — taxonomy + invariants. *(done in this change)*
2. `lib/approval-schema.mjs` — fill the stub bodies; unit-test the (de)serializers round-trip and
   the legacy-line → GENERAL parse. *(stub done in this change)*
3. `lib/approval-log.mjs` — append-only ledger on `appendLedgerRows` + `withPipelineLock`;
   validate `assertLedgerRowLegal`.
4. Extend `agent-inbox.mjs` — category-aware `add`/`list`/`approve`/`reject`; `orderApprovals`
   delegating to inbox-rank; `assertBatchApprovable` on any multi-item path.
5. Wire the nine producers (one follow-up per producer; out of scope beyond naming them here).
6. Tests (see §8).
7. Frontend reads the three artifacts.

## 8. Tests the backend must add (and keep green)

- `tests/agent-inbox*.test.mjs`, `tests/inbox-rank.test.mjs`, `tests/pipeline-lane-inbox.test.mjs`
  — **must stay green** (backward compatibility: legacy lines parse as GENERAL).
- SUBMIT invariant: `isBatchable('submit') === false`; `assertBatchApprovable` throws when a SUBMIT
  item is present; `assertLedgerRowLegal` throws on `{category:'submit', event:'approved'}`.
- Ledger actor invariant: every APPROVING event with `actor !== 'user'` is rejected.
- Round-trip: `serializeInboxLine` → `parseInboxText` preserves category/id/ref/sink; a legacy line
  yields GENERAL and never throws.
- Ordering: `orderApprovals` calls `scorePosting` (no second ranker); category weight precedes fit.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Hand-edit corrupts a `{…}` meta block in the checklist line | Ledger is the durable record; the inbox line is a rebuildable projection. Keep line meta minimal. |
| Artifact drift (approved sha ≠ bytes later used) | Record sha at approve; require re-approval if it changes before use (scan-at-sink). |
| Category weight is a policy choice | Expose it in `approval-categories.yml`; don't hardcode opaquely. |
| GENERAL vs categorized coexistence confuses "clear my queue" | `list` groups by category; GENERAL is its own group. |
| Over-engineering into a DB | One markdown + one TSV, mirroring the tracker+status-log pattern the repo already trusts. No server, no schema migration. |
| A producer forgets the SUBMIT rule | It can't: `batchable` is category-derived and the ledger guard rejects a machine approval regardless of caller. |
