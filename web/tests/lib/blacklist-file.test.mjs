import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBlacklist,
  serializeBlacklist,
  upsertBlacklistEntry,
  removeBlacklistEntry,
  blacklistEntryError,
} from "../../src/lib/core/blacklist-file.mjs";

const SAMPLE = `# Company Blacklist

Your own do-not-apply list.

| Company | Since | Scope | Reason |
|---------|-------|-------|--------|
| Acme Corp | 2026-01-15 | company | post-interview process signals |
| ibm.com | 2026-03-01 | domain | avoid IBM-owned ATS hosts |
`;

test("parseBlacklist reads the canonical 4-column table, skipping header and separator", () => {
  const entries = parseBlacklist(SAMPLE);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    company: "Acme Corp",
    since: "2026-01-15",
    scope: "company",
    reason: "post-interview process signals",
  });
  assert.equal(entries[1].company, "ibm.com");
  assert.equal(entries[1].scope, "domain");
});

test("parseBlacklist tolerates an absent/empty file", () => {
  assert.deepEqual(parseBlacklist(""), []);
  assert.deepEqual(parseBlacklist(null), []);
  assert.deepEqual(parseBlacklist(undefined), []);
});

test("parseBlacklist defaults a missing scope to company", () => {
  const entries = parseBlacklist(`| Company | Since | Scope | Reason |
|-|-|-|-|
| Globex | 2026-02-01 | | repeated applications |`);
  assert.equal(entries[0].scope, "company");
});

test("serializeBlacklist round-trips through parseBlacklist", () => {
  const entries = parseBlacklist(SAMPLE);
  const text = serializeBlacklist(entries, SAMPLE);
  assert.deepEqual(parseBlacklist(text), entries);
});

test("serializeBlacklist preserves the user's preamble prose", () => {
  const entries = parseBlacklist(SAMPLE);
  const text = serializeBlacklist(entries, SAMPLE);
  assert.match(text, /Your own do-not-apply list\./);
  assert.match(text, /# Company Blacklist/);
});

test("serializeBlacklist produces a valid default file when none exists", () => {
  const entries = [{ company: "Acme", since: "2026-01-15", scope: "company", reason: "x" }];
  const text = serializeBlacklist(entries, "");
  assert.match(text, /\| Company \| Since \| Scope \| Reason \|/);
  assert.deepEqual(parseBlacklist(text), entries);
});

test("upsertBlacklistEntry adds a new entry", () => {
  const next = upsertBlacklistEntry(parseBlacklist(SAMPLE), {
    company: "Globex",
    since: "2026-02-01",
    scope: "company",
    reason: "no conversion",
  });
  assert.equal(next.length, 3);
  assert.equal(next[2].company, "Globex");
});

test("upsertBlacklistEntry replaces an existing entry keyed on company+scope (case-insensitive)", () => {
  const next = upsertBlacklistEntry(parseBlacklist(SAMPLE), {
    company: "acme corp",
    since: "2026-05-05",
    scope: "company",
    reason: "updated reason",
  });
  assert.equal(next.length, 2);
  const acme = next.find((e) => e.company.toLowerCase() === "acme corp");
  assert.equal(acme.reason, "updated reason");
  assert.equal(acme.since, "2026-05-05");
});

test("upsertBlacklistEntry treats the same name under a different scope as distinct", () => {
  const next = upsertBlacklistEntry(parseBlacklist(SAMPLE), {
    company: "Acme Corp",
    since: "2026-05-05",
    scope: "domain",
    reason: "domain variant",
  });
  assert.equal(next.length, 3);
});

test("removeBlacklistEntry drops the matching company+scope", () => {
  const next = removeBlacklistEntry(parseBlacklist(SAMPLE), "Acme Corp", "company");
  assert.equal(next.length, 1);
  assert.equal(next[0].company, "ibm.com");
});

test("blacklistEntryError flags a missing company", () => {
  assert.match(blacklistEntryError({ company: "", scope: "company", reason: "x" }), /company/i);
});

test("blacklistEntryError rejects an invalid scope", () => {
  assert.match(blacklistEntryError({ company: "Acme", scope: "nope", reason: "x" }), /scope/i);
});

test("blacklistEntryError rejects a pipe character that would corrupt the table", () => {
  assert.match(blacklistEntryError({ company: "Ac|me", scope: "company", reason: "x" }), /\|/);
});

test("blacklistEntryError accepts a minimal valid entry", () => {
  assert.equal(blacklistEntryError({ company: "Acme", scope: "company", reason: "" }), null);
});

test("blacklistEntryError rejects a non-object", () => {
  assert.match(blacklistEntryError(null), /object/i);
});
