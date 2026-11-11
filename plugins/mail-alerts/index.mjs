// @ts-check
// mail-alerts plugin — ingest hook.
//
// Turns saved job-alert emails from LinkedIn / Indeed / Naukri / ZipRecruiter
// into pipeline candidates. The user drops .eml/.txt/.mbox files into
// {dataRoot}/data/mail-alerts/; this hook decodes each, dispatches it to the
// matching per-sender parser, and returns a flat Job[]. The ENGINE writes those
// jobs to data/pipeline.md and (because the manifest sets jobPostings:true)
// records them in data/scan-history.tsv via appendToScanHistory — this plugin
// never writes user-layer files itself.
//
// The emitted URLs are genuine aggregator URLs. They are UNCONFIRMED by design:
// the engine routes them into the pipeline, where the normal employer-
// confirmation and check-liveness.mjs gates run before any evaluation
// (AGENTS.md "Aggregator Listings — Confirm at the Employer"). This plugin
// never resolves employer URLs, never fabricates them, and never submits
// anything. Email content is untrusted external data: read, never obeyed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeMail } from './_mime.mjs';
import { parseEmail } from './parsers/_registry.mjs';
import { mailDropFiles } from '../../lib/linkedin-mail-drop.mjs';

const DROP_SUBDIR = ['data', 'mail-alerts'];

/** @type {{ ingest: (ctx: any) => Promise<any[]> }} */
const plugin = {
  async ingest(ctx) {
    const root = ctx?.dataRoot || process.cwd();
    const drop = join(root, ...DROP_SUBDIR);

    let files;
    try {
      files = mailDropFiles(drop);
    } catch {
      return []; // no drop folder yet — nothing to import
    }
    if (!files || files.length === 0) return [];

    const out = [];
    const seen = new Set();
    for (const file of files) {
      let raw;
      try {
        raw = readFileSync(file, 'utf8');
      } catch {
        ctx?.log?.(`mail-alerts: could not read ${file}`);
        continue;
      }
      let jobs = [];
      try {
        jobs = parseEmail(decodeMail(raw));
      } catch {
        ctx?.log?.(`mail-alerts: could not parse ${file}`);
      }
      for (const job of jobs) {
        if (!job || !job.url || seen.has(job.url)) continue;
        seen.add(job.url);
        out.push(job);
      }
    }
    ctx?.log?.(`mail-alerts: ${out.length} unconfirmed listing(s) from ${files.length} email(s)`);
    return out;
  },
};

export default plugin;
