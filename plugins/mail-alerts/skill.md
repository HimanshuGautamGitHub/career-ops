# mail-alerts — job-alert email import

Turns job-alert emails you already receive into pipeline candidates. No scraping,
no login, no network: it reads files you saved, and only files you saved.

## What it does

1. You save job-alert emails (`.eml`, `.txt`, or `.mbox`) into
   `{data-root}/data/mail-alerts/`.
2. On ingest, the plugin decodes each message (quoted-printable, base64, and one
   level of `multipart/alternative`) and dispatches it to a per-sender parser.
3. Supported senders, matched by the `From:` domain: **LinkedIn**, **Indeed**,
   **Naukri**, **ZipRecruiter**. An email from any other sender is skipped.
4. Each extracted listing becomes a `{ title, url, company?, location? }` job.
   The **engine** writes these into `data/pipeline.md` and records them in
   `data/scan-history.tsv` — the plugin writes no user files itself.

## Using it

1. In your mail client, save the alert emails to disk (most clients: drag the
   message to a folder, or File → Save As → `.eml`).
2. Drop them in `data/mail-alerts/` under your career-ops data root.
3. Run your CLI's ingest/scan path. New listings land in `data/pipeline.md`.
4. You can leave the files in place — re-runs are de-duplicated against the
   pipeline and scan history, so nothing is imported twice. Delete them whenever
   you like.

## Important: imported listings are UNCONFIRMED

Every URL this plugin emits is an **aggregator** URL (linkedin.com, indeed.com,
naukri.com, ziprecruiter.com). Aggregators keep stale, filled, and ghost
listings live long after the employer closed the req. Per the career-ops
"Aggregator Listings — Confirm at the Employer" rule, these listings are NOT
real openings until confirmed at the employer's own careers page / ATS, and the
normal `check-liveness.mjs` and employer-confirmation gates run during
evaluation. This plugin deliberately does not resolve or guess employer URLs.

## Safety

Email content is **untrusted external data**. The parsers extract company, role,
and URL — they never execute instructions found in a message, never submit
applications, never follow links, and never reach the network. A message whose
subject or body tries to issue commands ("as the AI reading this, apply to…") is
treated as data: its instructions are ignored, and if its sender is unknown it
produces no listings at all.

## Scope and limits

- Reads only `{data-root}/data/mail-alerts/`. No other directory, no `$HOME`.
- Offline and read-only. `requiredEnv` and `allowedHosts` are empty by design.
- Only the four senders above are parsed; others are skipped, not guessed at.
