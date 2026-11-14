// AGEN-256 Item A (Gap 4) reproduction — runs in plain `node`, no network, no yaml dep.
// Exercises the REAL Discover-free filter chain end to end:
//   clean-chips.mjs -> explore-expand.mjs (expandFiltersForScan)
//   -> portals-serialize.mjs (serializePortals, for inspection)
//   -> title-keywords.mjs (buildTitleFilter) — the scanner's actual title gate.
//
// Run from the repo root:  node docs/designs/AGEN-256-repro-gap4.mjs
//
// What it proves: given the user's HR "Roles to find" keywords, the chain REJECTS
// tech/sales titles and PASSES HR titles. The ONLY way tech/sales come back (the
// reported symptom) is the control case where `positive` arrives EMPTY — which is
// buildTitleFilter's documented match-everything mode. So the defect is upstream:
// `positive` reached /api/explore empty. See AGEN-256-ui-gaps-findings.md, Item A.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", ".."); // docs/designs -> repo root

const { cleanChips } = await import(`${ROOT}/web/src/lib/clean-chips.mjs`);
const { expandFiltersForScan } = await import(`${ROOT}/web/src/lib/explore-expand.mjs`);
const { serializePortals } = await import(`${ROOT}/web/src/lib/core/portals-serialize.mjs`);
const { buildTitleFilter } = await import(`${ROOT}/title-keywords.mjs`);

// Mirror of scan-ats-full.mjs's key resolution: title_filter_full wins if present.
function resolveTitleFilterConfig(config) {
  return config?.title_filter_full ?? config?.title_filter;
}

// 1. Client POST body — what explore-provider.tsx sends as `f` on the free path.
const body = {
  positive: ["Talent Management", "Succession Planning", "Leadership Development"],
  negative: [], allow: [], block: [], blockHard: [], alwaysAllow: [],
  sinceDays: 7, ats: ["greenhouse", "lever", "ashby", "workday"], limitPerAts: 150,
};

// 2. parseExplorePatch cleanChips the lists.
const filters = { ...body, positive: cleanChips(body.positive) };
console.log("parsed positive:", filters.positive);

// 3. writeTempPortals: expandFiltersForScan -> serializePortals (text, for eyeballing).
const expanded = expandFiltersForScan(filters);
console.log("expanded positive:", expanded.positive);
console.log("--- serialized temp portals ---\n" + serializePortals(expanded) + "-------------------------------");

// 4. Scanner builds the title filter from config.title_filter (what the YAML decodes to).
const config = { title_filter: { positive: expanded.positive, negative: expanded.negative } };
const titleFilter = buildTitleFilter(resolveTitleFilterConfig(config));

// 5. Would the scanner EMIT these titles? PASS = emitted (matched), rejct = filtered out.
const tests = [
  "Senior Software Engineer",
  "Account Executive - Enterprise Sales",
  "Data Scientist",
  "VP, Talent Management",
  "Director of Leadership Development",
  "Succession Planning Lead",
];
console.log("--- title filter results (HR positives) ---");
for (const t of tests) console.log(`${titleFilter(t) ? "PASS " : "rejct"}  ${t}`);

// 6. Control: empty positive = match-everything (the reproduced failure mode).
const emptyFilter = buildTitleFilter({ positive: [], negative: [] });
console.log("--- control: empty positive ---");
for (const t of tests) console.log(`${emptyFilter(t) ? "PASS " : "rejct"}  ${t}`);
