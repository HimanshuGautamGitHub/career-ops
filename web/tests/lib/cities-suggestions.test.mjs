// AGEN-254 Gap 4: city typeahead disambiguation data invariants. Pure data, so
// testable without a React renderer.
//
// Run:  node --experimental-strip-types --test tests/lib/cities-suggestions.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { CITY_SUGGESTIONS } from "../../src/data/cities.mjs";

test("every suggestion is a 'City, Country' label", () => {
  for (const entry of CITY_SUGGESTIONS) {
    assert.match(entry, /^.+,\s.+$/, `"${entry}" must carry a country after the comma`);
  }
});

test("the ambiguous-collision cases ship both variants", () => {
  // The motivating example (#AGEN-254): "Hyderabad" exists in India AND Pakistan,
  // so the typeahead must let the user pick which one.
  assert.ok(CITY_SUGGESTIONS.includes("Hyderabad, India"));
  assert.ok(CITY_SUGGESTIONS.includes("Hyderabad, Pakistan"));
  // A second collision, to prove it is a pattern, not a one-off.
  assert.ok(CITY_SUGGESTIONS.includes("Birmingham, United Kingdom"));
  assert.ok(CITY_SUGGESTIONS.includes("Birmingham, United States"));
});

test("no duplicate entries", () => {
  assert.equal(new Set(CITY_SUGGESTIONS).size, CITY_SUGGESTIONS.length);
});

test("the list is non-trivial", () => {
  assert.ok(CITY_SUGGESTIONS.length >= 40, "a starter list of real value, not a stub");
});
