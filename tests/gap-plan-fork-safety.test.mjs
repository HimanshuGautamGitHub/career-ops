// tests/gap-plan-fork-safety.test.mjs — the keystone fork-safety invariant for
// gap-plan.mjs (design docs/designs/FORK_SAFE_AUTOMATION.md §4.1/§5).
//
// gap-plan.mjs is a fork-owned, additive CLI. Its fork-safety is a *checkable*
// property, not a promise: a file is safe from the auto-updater iff it is NOT
// in SYSTEM_PATHS, and it is additionally protected from deletion / future
// upstream collision iff it is declared in config/local-paths.txt. This suite
// pins both halves so a later refactor can't silently promote gap-plan.mjs
// into the upstream-owned layer (where `update-system.mjs apply` would
// overwrite a fork's copy on every sync).

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { SYSTEM_PATHS } from '../lib/update-manifest.mjs';

console.log('\ngap-plan.mjs — fork-safety invariant');

// 1. gap-plan.mjs must NOT be in the updater's overwrite allowlist.
if (!SYSTEM_PATHS.includes('gap-plan.mjs')) {
  pass('gap-plan.mjs is not in SYSTEM_PATHS (the updater never overwrites it)');
} else {
  fail('gap-plan.mjs is in SYSTEM_PATHS — the auto-updater would overwrite a fork\'s copy on every sync');
}

// 2. gap-plan.mjs must be declared in config/local-paths.txt, so the updater
//    protects it and the coverage guard does not report it as an orphan.
let declared = false;
try {
  const raw = readFileSync(join(ROOT, 'config', 'local-paths.txt'), 'utf-8');
  declared = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .includes('gap-plan.mjs');
} catch (err) {
  fail(`could not read config/local-paths.txt: ${err.message}`);
}

if (declared) pass('gap-plan.mjs is declared in config/local-paths.txt (updater-protected, coverage-clean)');
else fail('gap-plan.mjs is not declared in config/local-paths.txt — it is unprotected and will read as a coverage orphan');
