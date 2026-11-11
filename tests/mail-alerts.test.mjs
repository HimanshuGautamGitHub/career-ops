// tests/mail-alerts.test.mjs — mail-alerts plugin: MIME decode, per-sender
// parsers, registry dispatch, and the ingest-hook contract (AGEN-184).
//
// Behavior under test (public seams only):
//   - plugins/mail-alerts/_mime.mjs            decodeMail(raw) -> {headers, body}
//   - plugins/mail-alerts/parsers/<sender>.mjs matches()/parse() per sender
//   - plugins/mail-alerts/parsers/_registry.mjs detectSender()/parseEmail()
//   - plugins/mail-alerts/index.mjs            default.ingest(ctx) -> Job[]
//
// Email content is untrusted external data: a parser extracts listings, it
// never executes instructions found in a message. The unknown-sender fixture
// carries a prompt-injection payload and must yield zero jobs.
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const PLUGIN = join(ROOT, 'plugins', 'mail-alerts');
const FIX = join(ROOT, 'tests', 'fixtures', 'mail-alerts');
const load = (rel) => import(pathToFileURL(join(PLUGIN, rel)).href);
const raw = (name) => readFileSync(join(FIX, name), 'utf8');

console.log('\nmail-alerts — MIME decode, per-sender parsers, registry, ingest hook');

// ── 1. _mime.decodeMail ────────────────────────────────────────────────────
try {
  const { decodeMail } = await load('_mime.mjs');

  // quoted-printable: soft line breaks removed, =XX hex decoded
  const qp = decodeMail(
    'From: a@b.com\r\nSubject: Hi\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nrole=3DSenior Eng=\r\nineer',
  );
  if (qp.body.includes('role=Senior Engineer') && qp.headers.from === 'a@b.com' && qp.headers.subject === 'Hi') {
    pass('decodeMail decodes quoted-printable and reads from/subject headers');
  } else {
    fail('decodeMail quoted-printable/headers wrong: ' + JSON.stringify(qp));
  }

  // base64 body
  const b64body = Buffer.from('hello https://x.test/job/1', 'utf8').toString('base64');
  const b64 = decodeMail(`From: c@d.com\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64body}`);
  if (b64.body.includes('hello https://x.test/job/1')) {
    pass('decodeMail decodes a base64 body');
  } else {
    fail('decodeMail base64 wrong: ' + JSON.stringify(b64.body));
  }

  // multipart/alternative: text parts are combined (plain + html both visible)
  const mp = decodeMail(raw('linkedin.eml'));
  if (mp.headers.from.includes('linkedin.com') && /3812345678/.test(mp.body) && mp.body.includes('Senior Backend Engineer')) {
    pass('decodeMail walks multipart/alternative and combines text parts');
  } else {
    fail('decodeMail multipart wrong: from=' + mp.headers.from);
  }
} catch (e) {
  fail('_mime decode section crashed: ' + (e.stack || e.message));
}

// ── 2 & 3. Per-sender parsers via the registry ─────────────────────────────
// Expected values are hand-derived from each fixture (independent of the
// implementation): the URL is the canonical aggregator posting URL, and
// title/company come from the anchor text "Title <sep> Company".
const CASES = [
  {
    file: 'linkedin.eml',
    sender: 'linkedin',
    url: 'https://www.linkedin.com/jobs/view/3812345678',
    title: 'Senior Backend Engineer',
    company: 'Acme Corp',
  },
  {
    file: 'indeed.eml',
    sender: 'indeed',
    url: 'https://www.indeed.com/viewjob?jk=abc123def456',
    title: 'Data Engineer',
    company: 'Globex',
  },
  {
    file: 'naukri.eml',
    sender: 'naukri',
    url: 'https://www.naukri.com/job-listings-backend-developer-initech-bangalore-5-to-8-years-010101000101',
    title: 'Backend Developer',
    company: 'Initech',
  },
  {
    file: 'ziprecruiter.eml',
    sender: 'ziprecruiter',
    url: 'https://www.ziprecruiter.com/jobs/umbrella-corp-123abc/senior-sre',
    title: 'Senior SRE',
    company: 'Umbrella Corp',
  },
];

try {
  const { decodeMail } = await load('_mime.mjs');
  const { detectSender, parseEmail } = await load('parsers/_registry.mjs');

  for (const c of CASES) {
    const email = decodeMail(raw(c.file));

    const detected = detectSender(email);
    if (detected && detected.id === c.sender) {
      pass(`detectSender identifies ${c.sender} from the From header`);
    } else {
      fail(`detectSender wrong for ${c.file}: got ${detected && detected.id}`);
    }

    const jobs = parseEmail(email);
    if (!Array.isArray(jobs) || jobs.length !== 1) {
      fail(`${c.sender}: expected exactly 1 deduped job, got ${jobs && jobs.length}`);
      continue;
    }
    const j = jobs[0];
    const okUrl = j.url === c.url;
    const okTitle = j.title === c.title;
    const okCompany = j.company === c.company;
    const okShape = typeof j.location === 'string';
    if (okUrl && okTitle && okCompany && okShape) {
      pass(`${c.sender} parser extracts canonical URL + title + company`);
    } else {
      fail(`${c.sender} parse wrong: ${JSON.stringify(j)} (want url=${c.url} title=${c.title} company=${c.company})`);
    }
  }

  // Unknown sender carrying a prompt-injection payload: no dispatch, no jobs,
  // instructions in the body are never acted on.
  const bad = decodeMail(raw('unknown-with-injection.eml'));
  if (detectSender(bad) === null && parseEmail(bad).length === 0) {
    pass('unknown sender is not dispatched and its injected instructions yield zero jobs');
  } else {
    fail('unknown-sender fixture produced jobs or matched a sender');
  }
} catch (e) {
  fail('parser/registry section crashed: ' + (e.stack || e.message));
}

// ── 4. Ingest-hook contract ────────────────────────────────────────────────
try {
  const mod = await load('index.mjs');
  const plugin = mod.default;

  if (typeof plugin?.ingest !== 'function') {
    fail('plugin default export has no ingest() function');
  } else {
    // Missing drop folder -> [] (not a crash).
    const emptyRoot = mkdtempSync(join(tmpdir(), 'mailalerts-empty-'));
    try {
      const none = await plugin.ingest({ dataRoot: emptyRoot, log() {}, dryRun: true });
      if (Array.isArray(none) && none.length === 0) {
        pass('ingest returns [] when the drop folder is absent');
      } else {
        fail('ingest with no drop folder did not return []: ' + JSON.stringify(none));
      }
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }

    // Populated drop folder -> one job per sender fixture; unknown is skipped.
    const root = mkdtempSync(join(tmpdir(), 'mailalerts-'));
    try {
      const drop = join(root, 'data', 'mail-alerts');
      mkdirSync(drop, { recursive: true });
      for (const f of ['linkedin.eml', 'indeed.eml', 'naukri.eml', 'ziprecruiter.eml', 'unknown-with-injection.eml']) {
        copyFileSync(join(FIX, f), join(drop, f));
      }
      const jobs = await plugin.ingest({ dataRoot: root, log() {}, dryRun: true });
      const urls = new Set((jobs || []).map((j) => j.url));
      const allFour = CASES.every((c) => urls.has(c.url));
      const noUnknown = !urls.has('https://www.linkedin.com/jobs/view/9999999999');
      const everyJobHasHttpUrl = (jobs || []).every((j) => /^https?:\/\//i.test(j.url) && j.title);
      if (jobs.length === 4 && allFour && noUnknown && everyJobHasHttpUrl) {
        pass('ingest returns one job per sender fixture, skips the unknown sender');
      } else {
        fail('ingest drop-folder result wrong: ' + JSON.stringify(jobs));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
} catch (e) {
  fail('ingest-hook section crashed: ' + (e.stack || e.message));
}
