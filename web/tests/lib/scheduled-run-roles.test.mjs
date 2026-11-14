import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRunRoles } from "../../src/lib/scheduled-run-roles.mjs";

test("formatRunRoles returns an empty list for records with no roles (backward compatible)", () => {
  // Pre-feature records carry no `roles` field — render count-only, exactly as before.
  assert.deepEqual(formatRunRoles({ rolesFound: 3 }), []);
  assert.deepEqual(formatRunRoles({ rolesFound: 0, roles: [] }), []);
  assert.deepEqual(formatRunRoles({}), []);
  assert.deepEqual(formatRunRoles(null), []);
  assert.deepEqual(formatRunRoles({ roles: "not-an-array" }), []);
});

test("formatRunRoles builds a title label and keeps the url when present", () => {
  assert.deepEqual(
    formatRunRoles({ roles: [{ title: "Succession Planning Lead", url: "https://acme.example/jobs/9" }] }),
    [{ label: "Succession Planning Lead", url: "https://acme.example/jobs/9" }],
  );
});

test("formatRunRoles appends the company to the label and omits a missing url", () => {
  assert.deepEqual(
    formatRunRoles({ roles: [{ title: "VP, Talent Management", company: "Acme" }] }),
    [{ label: "VP, Talent Management — Acme", url: undefined }],
  );
});

test("formatRunRoles skips malformed entries but keeps the valid ones", () => {
  assert.deepEqual(
    formatRunRoles({
      roles: [
        { title: "Director of Leadership Development", company: "Globex", url: "https://globex.example/2" },
        { company: "NoTitle" },
        { title: "   " },
        "garbage",
        null,
      ],
    }),
    [{ label: "Director of Leadership Development — Globex", url: "https://globex.example/2" }],
  );
});
