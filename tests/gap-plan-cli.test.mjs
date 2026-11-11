// tests/gap-plan-cli.test.mjs — end-to-end CLI tests for gap-plan.mjs.
//
// gap-plan.mjs --self-test and tests/gap-plan-core.test.mjs cover the pure
// functions. The CLI branches (report resolution, JD extraction from the
// archived section, markdown file write, --json shape) live inside the
// isMainModule() guard, so only a real-binary run reaches them. This suite
// runs the binary in a sandbox data root and asserts on what it actually
// prints and writes.
//
// It also re-asserts the no-fabrication invariant at the OUTPUT layer: the
// rendered markdown must never claim the candidate already has a gap skill,
// and the run must never create or modify cv.md / config/profile.yml (CV
// changes flow only through the add/expand modes — AGENTS.md Source-of-Truth
// Boundary).

import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, formatRunFailure, ROOT, NODE } from './helpers.mjs';

console.log('\ngap-plan.mjs — CLI (end-to-end)');

const dir = mkdtempSync(join(tmpdir(), 'co-gap-plan-cli-'));

// A report fixture carrying a real archived-JD section. The heading matches
// lib/jd-archive-section.mjs's JD_HEADING_RE (`## Job Description ...`), and the
// body is well over MIN_ARCHIVE_CHARS so check-jd-archive's extractor keeps it.
const REPORT = `# Acme — Senior Platform Engineer

**Score:** 4.1/5
**URL:** https://jobs.ashbyhq.com/acme/senior-platform-engineer
**Legitimacy:** likely-legitimate

## Verdict

Strong fit on the platform side.

## Job Description (archived verbatim)

About the role

YOU HAVE:
- Deep experience with Kubernetes and container orchestration
- Hands-on Terraform for infrastructure as code
- Familiarity with Rust for systems-level services
- Built dashboards with Grafana in production

## Machine Summary

\`\`\`yaml
company: Acme
\`\`\`
`;

const envFor = (root) => ({ ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' });

const runCli = (args) =>
  run(NODE, [join(ROOT, 'gap-plan.mjs'), ...args], { cwd: dir, env: envFor(dir) });

try {
  // cv.md names Terraform in a Skills section (so it is NOT a gap), mentions
  // Grafana only in prose (present-but-thin), and omits Kubernetes and Rust
  // entirely (true gaps).
  writeFileSync(
    join(dir, 'cv.md'),
    `# Experience

- Built internal monitoring dashboards with Grafana and Prometheus.

# Skills

Python, Docker, Terraform
`
  );
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(join(dir, 'reports', '042-acme-2026-11-11.md'), REPORT);

  // Snapshot the user-layer files to prove the run never touches them.
  const cvBefore = readFileSync(join(dir, 'cv.md'), 'utf-8');
  const profilePath = join(dir, 'config', 'profile.yml');
  const profileExistedBefore = existsSync(profilePath);

  // ---------------------------------------------------------------------------
  // 1. --json: the GapPlan shape reaches stdout and names the gaps correctly.
  // ---------------------------------------------------------------------------
  const out = runCli(['--report', '42', '--json']);
  if (out === null) {
    fail(`--report 42 --json run failed: ${formatRunFailure()}`);
  } else {
    let plan = null;
    try {
      plan = JSON.parse(out);
    } catch {
      fail(`--json stdout was not valid JSON — got: ${out.slice(0, 200)}`);
    }

    if (plan) {
      if (plan.reportNum === 42) pass('reportNum echoed from the resolved report');
      else fail(`reportNum expected 42, got ${plan.reportNum}`);

      if (plan.companySlug === 'acme') pass('companySlug parsed from the report filename');
      else fail(`companySlug expected acme, got ${plan.companySlug}`);

      if (typeof plan.generatedAt === 'string' && plan.generatedAt.length > 0) pass('generatedAt is a non-empty string');
      else fail(`generatedAt missing: ${JSON.stringify(plan.generatedAt)}`);

      const names = (plan.gaps || []).map((g) => g.skill.toLowerCase());

      if (names.some((n) => n === 'kubernetes')) pass('Kubernetes (absent from CV) surfaced as a gap');
      else fail(`Kubernetes not in gaps: ${JSON.stringify(names)}`);

      if (names.some((n) => n === 'rust')) pass('Rust (absent from CV) surfaced as a gap');
      else fail(`Rust not in gaps: ${JSON.stringify(names)}`);

      // Terraform is in the named Skills section → existing, never a gap.
      if (!names.some((n) => n === 'terraform')) pass('Terraform (in Skills) is not a gap');
      else fail(`Terraform should not be a gap: ${JSON.stringify(names)}`);

      // Grafana is only in prose → present-but-thin → evidenceInCv:true.
      const grafana = (plan.gaps || []).find((g) => /grafana/i.test(g.skill));
      if (grafana && grafana.evidenceInCv === true) pass('Grafana (CV prose only) → evidenceInCv:true');
      else fail(`Grafana expected as a present-but-thin gap: ${JSON.stringify(grafana)}`);

      const kubernetes = (plan.gaps || []).find((g) => /kubernetes/i.test(g.skill));
      if (kubernetes && kubernetes.evidenceInCv === false) pass('Kubernetes → evidenceInCv:false (missing)');
      else fail(`Kubernetes expected evidenceInCv:false: ${JSON.stringify(kubernetes)}`);

      // Every suggestion maps to a declared gap — no invented skills.
      const gapSkills = new Set((plan.gaps || []).map((g) => g.skill));
      if ((plan.suggestions || []).every((s) => gapSkills.has(s.skill))) pass('every suggestion.skill is a declared gap');
      else fail(`a suggestion names a non-gap skill: ${JSON.stringify(plan.suggestions)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. The markdown plan is written to data/gap-plans/{NNN}-{slug}.md and the
  //    rendered output carries no fabrication.
  // ---------------------------------------------------------------------------
  const planPath = join(dir, 'data', 'gap-plans', '042-acme.md');
  if (existsSync(planPath)) {
    pass('data/gap-plans/042-acme.md was written');

    const md = readFileSync(planPath, 'utf-8');
    const BANNED = [
      /\byou (?:have|know|are proficient|are experienced|are an expert)\b/i,
      /\byou(?:'re| are) proficient\b/i,
      /\balready (?:have|know|proficient|experienced)\b/i,
      /\bexpert in\b/i,
      /\bexperienced with\b/i,
    ];
    const hit = BANNED.find((re) => re.test(md));
    if (!hit) pass('rendered markdown contains no banned possession phrase');
    else fail(`rendered markdown contains a banned possession phrase (${hit})`);

    if (/kubernetes/i.test(md)) pass('rendered markdown names the Kubernetes gap');
    else fail('rendered markdown is missing the Kubernetes gap');
  } else {
    fail(`expected a gap plan at ${planPath}`);
  }

  // ---------------------------------------------------------------------------
  // 3. The run never creates or modifies cv.md / config/profile.yml.
  // ---------------------------------------------------------------------------
  const cvAfter = readFileSync(join(dir, 'cv.md'), 'utf-8');
  if (cvAfter === cvBefore) pass('cv.md is byte-identical after the run (never written)');
  else fail('cv.md changed — gap-plan must never write user-layer CV files');

  if (!profileExistedBefore && !existsSync(profilePath)) pass('config/profile.yml was not created by the run');
  else if (profileExistedBefore) pass('config/profile.yml pre-existed; not asserting (fixture has none)');
  else fail('config/profile.yml was created — gap-plan must never write it');

  // ---------------------------------------------------------------------------
  // 4. --no-write suppresses the markdown file but still prints JSON.
  // ---------------------------------------------------------------------------
  rmSync(join(dir, 'data', 'gap-plans'), { recursive: true, force: true });
  const outNoWrite = runCli(['--report', '42', '--json', '--no-write']);
  if (outNoWrite === null) {
    fail(`--no-write run failed: ${formatRunFailure()}`);
  } else {
    if (!existsSync(planPath)) pass('--no-write skips the markdown file');
    else fail('--no-write still wrote the markdown file');
    try {
      JSON.parse(outNoWrite);
      pass('--no-write still prints JSON to stdout');
    } catch {
      fail(`--no-write --json stdout was not valid JSON: ${outNoWrite.slice(0, 200)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. A report with no archived JD section errors clearly (non-zero exit).
  // ---------------------------------------------------------------------------
  writeFileSync(
    join(dir, 'reports', '043-nojd-2026-11-11.md'),
    '# NoJD — Role\n\n**Score:** 3/5\n\n## Verdict\n\nNo JD archived here.\n'
  );
  const outNoJd = runCli(['--report', '43', '--json']);
  if (outNoJd === null) pass('a report with no archived JD section exits non-zero');
  else fail(`expected a non-zero exit for a missing JD archive, got stdout: ${outNoJd.slice(0, 200)}`);

  // ---------------------------------------------------------------------------
  // 6. The script's own --self-test block runs green. This explicit launch (the
  //    name and the flag on one line) is also what the self-test-registration
  //    guard looks for — the runCli() helper hides the name behind ...args.
  // ---------------------------------------------------------------------------
  const selfTest = run(NODE, [join(ROOT, 'gap-plan.mjs'), '--self-test'], { cwd: dir, env: envFor(dir) });
  if (selfTest !== null && /--self-test: OK/.test(selfTest)) pass('gap-plan.mjs --self-test runs green');
  else fail(`gap-plan.mjs --self-test did not pass: ${formatRunFailure()}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
