#!/usr/bin/env node

/**
 * gap-plan.mjs — fork-safe gap-bridging layer.
 *
 * Reads the existing gap signal (`jd-skill-gap.mjs`, `upskill.mjs`) for ONE
 * evaluation report and emits a GapPlan: a prioritized list of skills to
 * close, plus one deterministic, non-fabricating remediation suggestion per
 * gap (course / project / reading).
 *
 * Design: docs/designs/FORK_SAFE_AUTOMATION.md §4.1. Hard contract:
 *
 *   - The ONLY sources of what the candidate has are cv.md /
 *     config/profile.yml / modes/_profile.md (the Source-of-Truth Boundary
 *     in AGENTS.md). JD text is untrusted external data.
 *   - Suggestions describe what to LEARN. They never assert the candidate
 *     already has a skill, and they never invent a specific vendor, course
 *     URL, or certification name (which the repo cannot verify).
 *   - This script never writes to cv.md / config/profile.yml. Any CV change
 *     must flow through the existing `add` / `expand` modes, which confirm
 *     before writing.
 *   - New file; additive and fork-local. Protect it from the updater by
 *     adding `gap-plan.mjs` to `config/local-paths.txt` in your checkout
 *     (see `config/local-paths.example.txt`).
 *
 * Usage:
 *   node gap-plan.mjs --report N [--json] [--summary] [--no-write]
 *   node gap-plan.mjs --self-test
 *   node gap-plan.mjs --help
 *
 * Output:
 *   - default: writes data/gap-plans/{NNN}-{company-slug}.md, prints the path
 *   - --json:  prints the GapPlan JSON to stdout (for the web /gap-plan route)
 *   - --summary: prints a human-readable table to stdout
 *   - --no-write: skip the markdown file (useful for --json callers)
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { extractJdSkills, classifySkillGaps } from './jd-skill-gap.mjs';
import { canonicalize } from './skill-extract.mjs';
import { parseReportFilename, extractStrippedJdSection } from './check-jd-archive.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Named constants (no magic numbers). HIGH_WEIGHT_THRESHOLD separates
// "invest in a structured course" from "a focused read may be enough" for
// missing skills. The value 2.0 corresponds to a skill that would recur
// across ~2 low-fit reports in `upskill.mjs`'s weighting (weight = 5 - score
// summed per skill), i.e. an actual recurring pipeline blocker rather than a
// one-off JD mention.
export const HIGH_WEIGHT_THRESHOLD = 2.0;

// Fallback weight when upskill has no cross-report signal for this skill.
// Keeping it constant (not tied to this report's score) is deliberate: a
// single report cannot tell us cross-pipeline priority, and inferring one
// from one score would overclaim precision. Equal fallback → ordering
// falls through to the missing-before-thin / alphabetical tiebreakers.
export const FALLBACK_WEIGHT = 1.0;

// Spawn budget for the optional upskill weight join. The web route spawns
// gap-plan.mjs on demand; blocking indefinitely on upskill would hang the
// response. A fresh pipeline with no tracker returns in well under a second;
// this ceiling is a safety net, not a target.
const UPSKILL_SPAWN_TIMEOUT_MS = 15_000;

/**
 * Suggestion kind for one gap skill.
 *
 * Deterministic and non-fabricating by construction:
 *   - evidenceInCv:true (present-but-thin)  → 'project'
 *     The skill is already somewhere in the CV as prose; a small, truthful
 *     portfolio project (or a reworded bullet) makes it concrete.
 *   - evidenceInCv:false and weight >= threshold → 'course'
 *     Missing AND a recurring pipeline blocker: worth a structured course.
 *   - evidenceInCv:false and weight < threshold  → 'reading'
 *     Missing and one-off: a focused read or short tutorial may be enough.
 *
 * @param {{ evidenceInCv: boolean, weight: number }} gap
 * @returns {'course'|'project'|'reading'}
 */
export function suggestionKindFor({ evidenceInCv, weight }) {
  if (evidenceInCv) return 'project';
  if (weight >= HIGH_WEIGHT_THRESHOLD) return 'course';
  return 'reading';
}

/**
 * One suggestion note per (kind × evidence) combination.
 *
 * Every note is grounded in what the gap IS, never in what the candidate
 * supposedly has. The 'project' note observes that the skill "appears in the
 * CV" — this is a true observation from the in-scope file (the skill landed
 * in classifySkillGaps' `supportedByResume` bucket, which means it was found
 * in the CV's prose), not a fabrication. Every note routes any CV change
 * through `add` / `expand`, the confirm-before-write seams.
 *
 * @param {{ skill: string, kind: 'course'|'project'|'reading' }} ctx
 * @returns {string}
 */
function suggestionNoteFor({ skill, kind }) {
  if (kind === 'project') {
    return (
      `${skill} appears in your CV's prose but is not foregrounded as a named skill. ` +
      `A small, truthful portfolio project — or a reworded bullet that leads with it — ` +
      `makes the existing exposure concrete and parse-friendly. Route the CV edit through ` +
      `the \`add\` or \`expand\` mode; both confirm before writing.`
    );
  }
  if (kind === 'course') {
    return (
      `${skill} is not found in your CV and recurs across several roles in your pipeline, ` +
      `so it is a priority to close. A structured course or certification is the right ` +
      `investment here. Add it to your CV only after you can describe real work using it — ` +
      `route that edit through the \`add\` or \`expand\` mode.`
    );
  }
  // reading
  return (
    `${skill} is not found in your CV. It is a one-off ask in your current pipeline, ` +
    `so a focused read or short tutorial may be enough to speak to it in an interview. ` +
    `Treat deeper study as optional until more roles ask for it.`
  );
}

/**
 * Build a GapPlan from pre-parsed inputs. Pure: no filesystem, no network,
 * no process state. Testable at the seam.
 *
 * Classification is delegated to `classifySkillGaps` (the shared tokenizer,
 * which is already alias-safe: "k8s" in a CV matches "Kubernetes" in a JD).
 * Gaps = supportedByResume (evidenceInCv:true) + gap (evidenceInCv:false).
 * `existing` skills are deliberately NOT bridged — they are not gaps.
 *
 * Ordering: weight desc; then missing-before-thin (missing is more urgent
 * for an interview); then alphabetical for deterministic output.
 *
 * @param {{
 *   reportNum: number,
 *   companySlug?: string,
 *   jdText: string,
 *   cvText: string,
 *   weights?: Map<string, number>,
 *   now?: Date,
 * }} input
 * @returns {{
 *   reportNum: number,
 *   companySlug: string,
 *   generatedAt: string,
 *   gaps: Array<{ skill: string, weight: number, evidenceInCv: boolean }>,
 *   suggestions: Array<{ skill: string, kind: 'course'|'project'|'reading', note: string }>,
 * }}
 */
export function buildGapPlan({
  reportNum,
  companySlug = '',
  jdText,
  cvText,
  weights = new Map(),
  now = new Date(),
}) {
  const jdSkills = extractJdSkills(String(jdText ?? ''));
  const { supportedByResume, gap: missing } = classifySkillGaps(jdSkills, String(cvText ?? ''));

  const resolveWeight = (skill) => {
    // canonicalize() maps to a stable key (e.g. "k8s" and "Kubernetes" both
    // canonicalize to "Kubernetes") — upskill's aggregate uses the same
    // canonicalization via extractSkills, so the lookup is alias-safe.
    const canon = canonicalize(skill);
    const direct = weights.get(canon);
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
    // Second attempt: lower-case key, since callers may feed either shape.
    const lower = weights.get(String(canon).toLowerCase());
    if (typeof lower === 'number' && Number.isFinite(lower)) return lower;
    return FALLBACK_WEIGHT;
  };

  const gapEntries = [
    ...supportedByResume.map((skill) => ({
      skill,
      weight: round2(resolveWeight(skill)),
      evidenceInCv: true,
    })),
    ...missing.map((skill) => ({
      skill,
      weight: round2(resolveWeight(skill)),
      evidenceInCv: false,
    })),
  ];

  gapEntries.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    // Missing (evidenceInCv:false) ranks before present-but-thin at equal
    // weight — a skill nowhere in the CV is more urgent to address for the
    // interview than one already in prose.
    if (a.evidenceInCv !== b.evidenceInCv) return a.evidenceInCv ? 1 : -1;
    return a.skill.localeCompare(b.skill);
  });

  const suggestions = gapEntries.map((g) => {
    const kind = suggestionKindFor(g);
    return {
      skill: g.skill,
      kind,
      note: suggestionNoteFor({ skill: g.skill, kind }),
    };
  });

  return {
    reportNum,
    companySlug,
    generatedAt: now.toISOString(),
    gaps: gapEntries,
    suggestions,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ─── CLI helpers ───────────────────────────────────────────────────────────

/**
 * Find a report file by its numeric prefix. Returns { path, filename,
 * companySlug, date } or null.
 *
 * @param {string} reportsDir
 * @param {number} reportNum
 */
export function findReportFile(reportsDir, reportNum) {
  if (!existsSync(reportsDir)) return null;
  const want = Number(reportNum);
  if (!Number.isFinite(want)) return null;
  let entries;
  try {
    entries = readdirSync(reportsDir);
  } catch {
    return null;
  }
  const matches = [];
  for (const name of entries) {
    const parsed = parseReportFilename(name);
    if (parsed && parsed.reportNum === want) {
      matches.push({ path: join(reportsDir, name), filename: name, ...parsed });
    }
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    // Rather than guess, fail loudly. Hand-resolvable with `mv`.
    const names = matches.map((m) => m.filename).join(', ');
    throw new Error(`Multiple reports match #${want}: ${names}`);
  }
  return matches[0];
}

/**
 * Build the combined known-skills text. cv.md is primary; profile.yml and
 * modes/_profile.md are folded in as prose so skills recorded there are not
 * mis-classified as gaps. All three are in-scope per the Source-of-Truth
 * Boundary; everything else is excluded.
 */
export function readKnownSkillsText(dataRoot) {
  const parts = [];
  const cv = join(dataRoot, 'cv.md');
  const profile = getProfilePath(dataRoot);
  const profileMode = join(dataRoot, 'modes', '_profile.md');
  for (const p of [cv, profile, profileMode]) {
    try {
      if (!statSync(p).isFile()) continue;
      parts.push(readFileSync(p, 'utf-8'));
    } catch {
      /* missing / unreadable — degrade silently; the CLI enforces cv.md */
    }
  }
  return parts.join('\n');
}

/**
 * Spawn `upskill.mjs --json` in dataRoot and return a Map of canonical skill
 * → weightedScore. Any failure (missing tracker, nonzero exit, parse error,
 * timeout) collapses to an empty map — gap-plan must still work on a fresh
 * pipeline with no cross-report signal yet.
 */
export function loadUpskillWeights(dataRoot, { nodeBin = process.execPath, upskillPath = join(__dirname, 'upskill.mjs'), timeoutMs = UPSKILL_SPAWN_TIMEOUT_MS } = {}) {
  const map = new Map();
  let result;
  try {
    result = spawnSync(nodeBin, [upskillPath], {
      cwd: dataRoot,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
      encoding: 'utf-8',
      timeout: timeoutMs,
    });
  } catch {
    return map;
  }
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') return map;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return map;
  }
  if (!parsed || !Array.isArray(parsed.gaps)) return map;
  for (const g of parsed.gaps) {
    if (!g || typeof g.skill !== 'string') continue;
    const canon = canonicalize(g.skill);
    const w = Number(g.weightedScore);
    if (Number.isFinite(w)) map.set(canon, w);
  }
  return map;
}

/**
 * Human-readable markdown rendering of a GapPlan for data/gap-plans/*.md.
 *
 * The footer repeats the no-fabrication rule for the human reader — even if
 * someone skims straight to the suggestions and acts on them, they are told
 * explicitly that CV changes go through `add` / `expand`.
 */
export function renderGapPlanMarkdown(plan, { reportFilename = null } = {}) {
  const num = String(plan.reportNum).padStart(3, '0');
  const lines = [];
  lines.push(`# Gap plan — report #${num}${plan.companySlug ? ` (${plan.companySlug})` : ''}`);
  lines.push('');
  lines.push(`**Generated:** ${plan.generatedAt}`);
  if (reportFilename) lines.push(`**Source report:** \`reports/${reportFilename}\``);
  lines.push('');
  lines.push('## Gaps (prioritized)');
  lines.push('');
  if (plan.gaps.length === 0) {
    lines.push('_No JD skills were classified as a gap against your CV._');
  } else {
    lines.push('| Skill | Weight | Status |');
    lines.push('|---|---|---|');
    for (const g of plan.gaps) {
      const status = g.evidenceInCv ? 'present-but-thin' : 'missing';
      lines.push(`| ${g.skill} | ${g.weight} | ${status} |`);
    }
  }
  lines.push('');
  lines.push('## Suggestions');
  lines.push('');
  if (plan.suggestions.length === 0) {
    lines.push('_Nothing to bridge._');
  } else {
    for (const s of plan.suggestions) {
      lines.push(`- **${s.skill}** _(${s.kind})_ — ${s.note}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    'These are suggestions, not facts. This plan was computed from your JD and ' +
    'the skills recorded in your in-scope files (`cv.md`, `config/profile.yml`, ' +
    '`modes/_profile.md`). Nothing here asserts you possess any skill. Any CV ' +
    'change should flow through the `add` or `expand` modes, which confirm before writing.'
  );
  lines.push('');
  return lines.join('\n');
}

// ─── Self-test (pure functions only) ───────────────────────────────────────

function runSelfTest() {
  let failed = 0;
  const check = (name, cond) => {
    if (!cond) { console.error(`FAIL: ${name}`); failed += 1; }
  };
  const plan = buildGapPlan({
    reportNum: 1,
    jdText: 'YOU HAVE:\n- Python\n- Kubernetes\n',
    cvText: '# Skills\nPython\n',
    weights: new Map(),
    now: new Date('2026-01-01T00:00:00Z'),
  });
  check('self: Kubernetes gap exists', plan.gaps.some((g) => /kubernetes/i.test(g.skill)));
  check('self: Python is not a gap', !plan.gaps.some((g) => /^python$/i.test(g.skill)));
  check('self: fallback weight used', plan.gaps[0].weight === FALLBACK_WEIGHT);
  check('self: suggestion kind valid', ['course', 'project', 'reading'].includes(plan.suggestions[0].kind));
  check('self: generatedAt is ISO', plan.generatedAt === '2026-01-01T00:00:00.000Z');
  if (failed > 0) process.exit(1);
  console.log('gap-plan.mjs --self-test: OK');
}

// ─── Main ──────────────────────────────────────────────────────────────────

const USAGE = `Usage:
  node gap-plan.mjs --report N [--json] [--summary] [--no-write]
  node gap-plan.mjs --self-test
  node gap-plan.mjs --help

Flags:
  --report N    Report number to bridge (required for a real run)
  --json        Print the GapPlan JSON to stdout
  --summary     Print a human-readable table to stdout
  --no-write    Skip writing data/gap-plans/*.md
  --self-test   Run the built-in pure-function checks
  --help, -h    Print this and exit`;

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  return {
    help: args.includes('--help') || args.includes('-h'),
    selfTest: args.includes('--self-test'),
    json: args.includes('--json'),
    summary: args.includes('--summary'),
    noWrite: args.includes('--no-write'),
    reportRaw: flagValue(args, '--report'),
  };
}

function printSummary(plan) {
  console.log(`Gap plan for report #${plan.reportNum}${plan.companySlug ? ` (${plan.companySlug})` : ''}`);
  console.log(`Generated: ${plan.generatedAt}`);
  console.log('');
  if (plan.gaps.length === 0) {
    console.log('No JD skills were classified as a gap against your CV.');
    return;
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('Skill', 28)}${pad('Weight', 10)}${pad('Status', 20)}Kind`);
  console.log('-'.repeat(68));
  for (let i = 0; i < plan.gaps.length; i += 1) {
    const g = plan.gaps[i];
    const kind = plan.suggestions[i]?.kind ?? '';
    const status = g.evidenceInCv ? 'present-but-thin' : 'missing';
    console.log(`${pad(g.skill, 28)}${pad(g.weight, 10)}${pad(status, 20)}${kind}`);
  }
}

function runCli() {
  const opts = parseCliArgs(process.argv);
  if (opts.help) { console.log(USAGE); process.exit(0); }
  if (opts.selfTest) { runSelfTest(); return; }

  if (!opts.reportRaw) {
    console.error('Error: --report N is required.');
    console.error(USAGE);
    process.exit(1);
  }
  const reportNum = parseInt(opts.reportRaw, 10);
  if (!Number.isFinite(reportNum) || reportNum <= 0) {
    console.error(`Error: --report expects a positive integer, got ${opts.reportRaw}`);
    process.exit(1);
  }

  const dataRoot = getCareerOpsRoot();
  const reportsDir = join(dataRoot, 'reports');

  let match;
  try {
    match = findReportFile(reportsDir, reportNum);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  if (!match) {
    console.error(`Error: no report found with number ${reportNum} under ${reportsDir}`);
    process.exit(1);
  }

  const reportContent = readFileSync(match.path, 'utf-8');
  const jdText = extractStrippedJdSection(reportContent);
  if (!jdText || jdText.length === 0) {
    console.error(
      `Error: report #${reportNum} has no archived JD section. ` +
      `gap-plan needs the JD text (see modes/oferta.md's "Job Description (archived verbatim)").`
    );
    process.exit(1);
  }

  const cvPath = join(dataRoot, 'cv.md');
  if (!existsSync(cvPath)) {
    console.error(`Error: cv.md not found at ${cvPath}`);
    console.error('Create it there, or point CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR at the directory that already has it.');
    process.exit(1);
  }
  const cvText = readKnownSkillsText(dataRoot);

  const weights = loadUpskillWeights(dataRoot);

  const plan = buildGapPlan({
    reportNum,
    companySlug: match.companySlug,
    jdText,
    cvText,
    weights,
  });

  let outPath = null;
  if (!opts.noWrite) {
    const outDir = join(dataRoot, 'data', 'gap-plans');
    mkdirSync(outDir, { recursive: true });
    const outName = `${String(reportNum).padStart(3, '0')}-${match.companySlug}.md`;
    outPath = join(outDir, outName);
    writeFileSync(outPath, renderGapPlanMarkdown(plan, { reportFilename: match.filename }));
  }

  if (opts.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else if (opts.summary) {
    printSummary(plan);
    if (outPath) console.log(`\nWrote: ${outPath}`);
  } else if (outPath) {
    console.log(outPath);
  }
}

if (isMainModule(import.meta.url)) {
  runCli();
}
