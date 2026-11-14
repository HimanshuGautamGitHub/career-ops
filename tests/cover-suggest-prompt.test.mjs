/**
 * cover-suggest-prompt.test.mjs — the Source-of-Truth Boundary gate for the
 * cover-letter "Suggest with AI" path (AGEN-265).
 *
 * The user asked: "on draft cover letter: system should auto fill or auto
 * suggest with AI from users Resume or if user's Claude is used then use
 * context about user to fill this." AGENTS.md's Source-of-Truth Boundary makes
 * the second clause a hard constraint: "context about user" means the in-scope
 * user-layer files ONLY, never Claude's auto-memory or any cross-session /
 * cross-project / out-of-scope read. Contrast apply/prefill and explore/ai,
 * which DO inject readMemory(); this path must NOT.
 *
 * This suite pins buildCoverSuggestPrompt() as a value: the prompt it produces
 * must ground in the in-scope files, must forbid auto-memory and out-of-scope
 * reads in words, and must never accept a memory parameter or import
 * readMemory. If a later edit reintroduces a memory channel, this fails.
 */
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const MODULE = 'web/src/lib/cover-suggest-prompt.mjs';

function check(name, fn) {
  try {
    const problem = fn();
    if (problem) fail(`${name}: ${problem}`);
    else pass(name);
  } catch (err) {
    fail(`${name}: ${err.message}`);
  }
}

async function run() {
  const mod = await load(MODULE);
  if (typeof mod.buildCoverSuggestPrompt !== 'function') {
    fail('cover-suggest-prompt exports buildCoverSuggestPrompt(): not a function');
    return;
  }
  const { buildCoverSuggestPrompt } = mod;

  const sample = buildCoverSuggestPrompt({
    input: '42',
    reportFile: 'reports/042-acme-2026-01-01.md',
    company: 'Acme',
    role: 'Staff Engineer',
  });

  check('returns a non-empty string', () => {
    if (typeof sample !== 'string' || sample.trim().length === 0) return 'expected a non-empty prompt string';
    return null;
  });

  // (a) Grounds in the in-scope user-layer files and the evaluation report.
  const inScope = ['cv.md', 'config/profile.yml', 'article-digest.md', 'modes/_profile.md', 'writing-samples'];
  check('names every in-scope source the boundary allows', () => {
    const missing = inScope.filter((f) => !sample.includes(f));
    return missing.length ? `prompt omits in-scope sources: ${missing.join(', ')}` : null;
  });
  check('points at the evaluation report it was given', () => {
    return sample.includes('reports/042-acme-2026-01-01.md') ? null : 'prompt does not reference the passed reportFile';
  });

  // (b) Forbids auto-memory and every out-of-scope read, in words.
  check('forbids auto-memory in words', () => {
    return /auto-memory/i.test(sample) ? null : 'prompt never names auto-memory as forbidden';
  });
  check('forbids cross-session / cross-project / out-of-scope reads', () => {
    const lower = sample.toLowerCase();
    const hasProhibition = /\b(do not|never|must not)\b/.test(lower);
    const namesOutOfScope = lower.includes('cross-session') || lower.includes('cross-project') || lower.includes('outside the career-ops project') || lower.includes('out of scope') || lower.includes('out-of-scope');
    if (!hasProhibition) return 'prompt lacks an explicit prohibition verb';
    if (!namesOutOfScope) return 'prompt never names cross-session / cross-project / out-of-scope reads';
    return null;
  });
  check('tells the model never to invent facts', () => {
    return /never (invent|fabricate)|do not (invent|fabricate)/i.test(sample) ? null : 'prompt does not forbid fabrication';
  });

  // (c) Emits the {why, problem, approach, tone} JSON contract, no prose/fence.
  check('demands the why/problem/approach/tone JSON contract', () => {
    for (const key of ['why', 'problem', 'approach', 'tone']) {
      if (!sample.includes(key)) return `prompt output contract omits "${key}"`;
    }
    return null;
  });
  check('forbids prose, markdown and code fences around the JSON', () => {
    return /no prose, no markdown, no code fence/i.test(sample) ? null : 'prompt does not pin the compact-JSON-only output rule';
  });
  check('lists the valid tone keys so the model cannot invent one', () => {
    // COVER_TONES keys must appear so the suggestion stays inside the enum.
    const tones = ['formal', 'direct', 'conversational', 'mirror'];
    const missing = tones.filter((t) => !sample.includes(t));
    return missing.length ? `prompt omits valid tone keys: ${missing.join(', ')}` : null;
  });

  // (d) The module itself can never pull from auto-memory: no memory parameter,
  // no readMemory import. This is the structural half of the boundary — the
  // prompt text above is the behavioural half.
  const src = read(MODULE);
  check('source never imports or calls readMemory', () => {
    return /readMemory/.test(src) ? 'cover-suggest-prompt references readMemory — the boundary is breached' : null;
  });
  check('buildCoverSuggestPrompt takes no memory parameter', () => {
    // The signature line must not destructure a `memory` field.
    const sig = src.slice(src.indexOf('export function buildCoverSuggestPrompt'));
    const firstParen = sig.slice(sig.indexOf('('), sig.indexOf(')') + 1);
    return /\bmemory\b/.test(firstParen) ? 'signature accepts a memory parameter — forbidden on this path' : null;
  });
  check('a passed memory field is ignored, not interpolated', () => {
    const leaked = buildCoverSuggestPrompt({
      input: '42',
      reportFile: 'reports/042-acme-2026-01-01.md',
      company: 'Acme',
      role: 'Staff Engineer',
      // @ts-expect-error — deliberately smuggling a memory field the type forbids.
      memory: 'SECRET_AUTO_MEMORY_LEAK_CANARY',
    });
    return leaked.includes('SECRET_AUTO_MEMORY_LEAK_CANARY') ? 'a smuggled memory field leaked into the prompt' : null;
  });
}

await run();
