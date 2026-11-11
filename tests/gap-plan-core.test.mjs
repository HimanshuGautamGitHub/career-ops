// tests/gap-plan-core.test.mjs — pure-function tests for gap-plan.mjs
//
// gap-plan.mjs is the fork-safe gap-bridging layer (AGEN-186, design doc
// `docs/designs/FORK_SAFE_AUTOMATION.md` §4.1). It layers on top of the
// existing analysis (`jd-skill-gap.mjs`, `upskill.mjs`) and never fabricates
// candidate skills: suggestions describe what to *learn*, grounded in the
// gap output; they never assert the candidate already has something.
//
// This file covers the PURE core (`buildGapPlan`). CLI behaviour, file
// output and no-fabrication CLI invariants live in sibling test files.

import { pass, fail } from './helpers.mjs';
import { buildGapPlan, suggestionKindFor, FALLBACK_WEIGHT, HIGH_WEIGHT_THRESHOLD } from '../gap-plan.mjs';

console.log('\ngap-plan.mjs — pure core (buildGapPlan)');

// ---------------------------------------------------------------------------
// 1. Basic gap: a JD skill missing from cv.md shows up with evidenceInCv:false
//    and a non-empty suggestion.
// ---------------------------------------------------------------------------
{
  const cv = '# Skills\nPython, Docker\n';
  const jd = '# Role\n\nYOU HAVE:\n- Experience with Python and Kubernetes\n';
  const plan = buildGapPlan({
    reportNum: 42,
    companySlug: 'acme',
    jdText: jd,
    cvText: cv,
    weights: new Map(),
    now: new Date('2026-11-11T00:00:00Z'),
  });

  if (plan.reportNum === 42) pass('reportNum echoed');
  else fail(`reportNum expected 42, got ${plan.reportNum}`);

  if (plan.generatedAt === '2026-11-11T00:00:00.000Z') pass('generatedAt is the injected ISO instant');
  else fail(`generatedAt expected 2026-11-11T00:00:00.000Z, got ${plan.generatedAt}`);

  const kubernetes = plan.gaps.find((g) => /kubernetes/i.test(g.skill));
  if (kubernetes) pass('Kubernetes surfaced as a gap');
  else {
    fail(`Kubernetes not in gaps: ${JSON.stringify(plan.gaps)}`);
  }

  if (kubernetes && kubernetes.evidenceInCv === false) pass('Kubernetes marked evidenceInCv:false (missing)');
  else if (kubernetes) fail(`evidenceInCv expected false for a missing skill, got ${kubernetes.evidenceInCv}`);

  // A missing-from-CV gap with no cross-report weight gets the single-report
  // fallback weight. Floor is a named constant, not a magic number.
  if (kubernetes && kubernetes.weight === FALLBACK_WEIGHT) pass(`Kubernetes weight = FALLBACK_WEIGHT (${FALLBACK_WEIGHT})`);
  else if (kubernetes) fail(`weight expected FALLBACK_WEIGHT=${FALLBACK_WEIGHT}, got ${kubernetes.weight}`);

  const kSuggestion = plan.suggestions.find((s) => /kubernetes/i.test(s.skill));
  if (kSuggestion && typeof kSuggestion.note === 'string' && kSuggestion.note.length > 0) pass('Kubernetes has a suggestion with a non-empty note');
  else fail(`Kubernetes suggestion missing or empty: ${JSON.stringify(kSuggestion)}`);

  if (kSuggestion && ['course', 'project', 'reading'].includes(kSuggestion.kind)) pass(`suggestion kind is in enum: ${kSuggestion.kind}`);
  else fail(`suggestion kind not in course|project|reading: ${JSON.stringify(kSuggestion)}`);

  // A JD skill that IS in the CV must not become a gap.
  if (!plan.gaps.some((g) => /^python$/i.test(g.skill))) pass('Python (in CV) is not a gap');
  else fail(`Python should not be a gap: ${JSON.stringify(plan.gaps)}`);
}

// ---------------------------------------------------------------------------
// 2. Cross-report weights (upskill aggregate) drive priority ordering.
// ---------------------------------------------------------------------------
{
  const cv = '# Skills\nPython\n';
  const jd = '# Role\n\nYOU HAVE:\n- Rust\n- Kubernetes\n- Terraform\n';
  const weights = new Map([
    ['kubernetes', 3.5],   // most urgent — recurs across many pipeline reports
    ['rust', 0.75],        // mild
    // terraform absent → falls back to FALLBACK_WEIGHT
  ]);
  const plan = buildGapPlan({
    reportNum: 7,
    companySlug: 'acme',
    jdText: jd,
    cvText: cv,
    weights,
    now: new Date('2026-11-11T00:00:00Z'),
  });

  const names = plan.gaps.map((g) => g.skill.toLowerCase());
  const kIdx = names.findIndex((n) => n === 'kubernetes');
  const rIdx = names.findIndex((n) => n === 'rust');
  const tIdx = names.findIndex((n) => n === 'terraform');

  if (kIdx !== -1 && rIdx !== -1 && tIdx !== -1) pass('all three gaps present');
  else fail(`missing a gap: ${JSON.stringify(names)}`);

  if (kIdx < tIdx && tIdx < rIdx) pass('ordered by weight desc: kubernetes(3.5) > terraform(fallback=1.0) > rust(0.75)');
  else fail(`wrong order (expected kubernetes, terraform, rust): ${JSON.stringify(names)}`);

  const kGap = plan.gaps[kIdx];
  if (kGap && kGap.weight === 3.5) pass('kubernetes weight = 3.5 from injected map');
  else fail(`kubernetes weight expected 3.5, got ${kGap && kGap.weight}`);

  // High-weight missing skills get a 'course' suggestion; low-weight missing
  // skills get 'reading'. This uses all three enum values meaningfully and
  // ties the recommendation type to measured priority.
  const kSug = plan.suggestions.find((s) => /kubernetes/i.test(s.skill));
  if (kSug && kSug.kind === 'course') pass('high-weight missing → course');
  else fail(`high-weight missing expected 'course', got ${JSON.stringify(kSug)}`);

  const rSug = plan.suggestions.find((s) => /rust/i.test(s.skill));
  if (rSug && rSug.kind === 'reading') pass('low-weight missing → reading');
  else fail(`low-weight missing expected 'reading', got ${JSON.stringify(rSug)}`);
}

// ---------------------------------------------------------------------------
// 3. Present-but-thin: a JD skill mentioned only in CV prose (not the named
//    Skills section) lands in supportedByResume → evidenceInCv:true, kind
//    'project' (deepen existing exposure into a describable proof point).
// ---------------------------------------------------------------------------
{
  const cv = `# Experience
- Built internal dashboards with Grafana and Prometheus.

# Skills
Python, Docker
`;
  const jd = '# Role\n\nYOU HAVE:\n- Grafana\n- Terraform\n';
  const plan = buildGapPlan({
    reportNum: 9,
    companySlug: 'acme',
    jdText: jd,
    cvText: cv,
    weights: new Map(),
  });

  const grafana = plan.gaps.find((g) => /grafana/i.test(g.skill));
  if (grafana && grafana.evidenceInCv === true) pass('Grafana (CV prose only) → evidenceInCv:true');
  else fail(`Grafana expected evidenceInCv:true, got ${JSON.stringify(grafana)}`);

  const gSug = plan.suggestions.find((s) => /grafana/i.test(s.skill));
  if (gSug && gSug.kind === 'project') pass('present-but-thin → project');
  else fail(`present-but-thin expected 'project', got ${JSON.stringify(gSug)}`);

  const terra = plan.gaps.find((g) => /terraform/i.test(g.skill));
  if (terra && terra.evidenceInCv === false) pass('Terraform (nowhere in CV) → evidenceInCv:false');
  else fail(`Terraform expected evidenceInCv:false, got ${JSON.stringify(terra)}`);
}

// ---------------------------------------------------------------------------
// 4. No-fabrication invariant: suggestion notes never assert possession of
//    the skill (no "you have X", "you are proficient in X", etc.). The pure
//    function is where the discipline starts — the CLI test re-asserts it on
//    the full markdown output.
// ---------------------------------------------------------------------------
{
  const cv = '# Skills\nPython\n';
  const jd = '# Role\n\nYOU HAVE:\n- Rust\n- Kubernetes\n- Grafana\n';
  const plan = buildGapPlan({
    reportNum: 1,
    companySlug: 'acme',
    jdText: jd,
    cvText: cv,
    weights: new Map([['kubernetes', 4.0]]),
  });

  // Banned phrases: any claim that the candidate already has the skill. Case-
  // insensitive. "already (have|know)" catches both forms; "proficient in",
  // "expert in", "experienced with", "you have" cover the common fabrications.
  const BANNED = [
    /\byou (?:have|know|are proficient|are experienced|are an expert)\b/i,
    /\byou(?:'re| are) proficient\b/i,
    /\balready (?:have|know|proficient|experienced)\b/i,
    /\bexpert in\b/i,
    /\bexperienced with\b/i,
  ];
  let fabrications = 0;
  for (const s of plan.suggestions) {
    for (const re of BANNED) {
      if (re.test(s.note)) {
        fail(`suggestion for ${s.skill} contains banned possession phrase (${re}): ${JSON.stringify(s.note)}`);
        fabrications += 1;
      }
    }
  }
  if (fabrications === 0) pass('no suggestion note claims the candidate already has the skill');

  // Every suggestion.skill must come from the gaps list (a strict subset — it
  // is literally the per-gap bridge recommendation, so an extra skill would be
  // inventing a gap).
  const gapSkills = new Set(plan.gaps.map((g) => g.skill));
  if (plan.suggestions.every((s) => gapSkills.has(s.skill))) pass('every suggestion.skill is a gap.skill');
  else fail(`a suggestion names a skill that is not in the gaps list: ${JSON.stringify(plan.suggestions)}`);
}

// ---------------------------------------------------------------------------
// 5. suggestionKindFor is a pure helper; the threshold is a named constant
//    with non-magic value, and the mapping is exhaustive over evidenceInCv.
// ---------------------------------------------------------------------------
{
  if (typeof HIGH_WEIGHT_THRESHOLD === 'number' && HIGH_WEIGHT_THRESHOLD > 0) pass(`HIGH_WEIGHT_THRESHOLD is a positive number: ${HIGH_WEIGHT_THRESHOLD}`);
  else fail(`HIGH_WEIGHT_THRESHOLD not a positive number: ${HIGH_WEIGHT_THRESHOLD}`);

  if (suggestionKindFor({ evidenceInCv: true, weight: 10 }) === 'project') pass('evidenceInCv:true → project regardless of weight');
  else fail(`evidenceInCv:true expected project`);

  if (suggestionKindFor({ evidenceInCv: false, weight: HIGH_WEIGHT_THRESHOLD }) === 'course') pass('at threshold, missing → course');
  else fail(`at threshold missing expected course`);

  if (suggestionKindFor({ evidenceInCv: false, weight: HIGH_WEIGHT_THRESHOLD - 0.01 }) === 'reading') pass('below threshold, missing → reading');
  else fail(`below threshold missing expected reading`);
}
