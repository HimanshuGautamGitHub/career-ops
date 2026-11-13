import { test } from "node:test";
import assert from "node:assert/strict";
import { profileToForm } from "../../src/lib/profile-form.mjs";

test("profileToForm maps the fields the web write path owns", () => {
  const form = profileToForm({
    candidate: { full_name: "Jane Smith", email: "jane@example.com", location: "San Francisco, CA" },
    target_roles: { primary: ["Senior Backend Engineer", "Platform Engineer"] },
    compensation: { target_range: "150000-200000", currency: "USD", location_flexibility: "Remote preferred" },
  });
  assert.equal(form.name, "Jane Smith");
  assert.equal(form.email, "jane@example.com");
  assert.equal(form.location, "San Francisco, CA");
  assert.deepEqual(form.roles, ["Senior Backend Engineer", "Platform Engineer"]);
  assert.equal(form.compMin, 150000);
  assert.equal(form.compMax, 200000);
  assert.equal(form.currency, "USD");
  assert.equal(form.remote, "Remote preferred");
});

test("profileToForm returns blank defaults for an empty/absent profile", () => {
  const form = profileToForm(null);
  assert.equal(form.name, "");
  assert.equal(form.email, "");
  assert.equal(form.location, "");
  assert.deepEqual(form.roles, []);
  assert.equal(form.compMin, null);
  assert.equal(form.compMax, null);
  assert.equal(form.currency, "");
  assert.equal(form.remote, "");
});

test("profileToForm keeps a non-numeric comp range as raw text without guessing min/max", () => {
  const form = profileToForm({ compensation: { target_range: "$150K-200K" } });
  assert.equal(form.compMin, null);
  assert.equal(form.compMax, null);
  assert.equal(form.compRange, "$150K-200K");
});

test("profileToForm ignores a malformed target_roles shape", () => {
  const form = profileToForm({ target_roles: "oops" });
  assert.deepEqual(form.roles, []);
});

test("profileToForm tolerates a primary roles string instead of a list", () => {
  const form = profileToForm({ target_roles: { primary: "Backend Engineer" } });
  assert.deepEqual(form.roles, ["Backend Engineer"]);
});

test("profileToForm surfaces the AGEN-249 structured fields (location block, work_setup, first archetype level)", () => {
  const form = profileToForm({
    location: { city: "Berlin", country: "Germany" },
    work_setup: "hybrid",
    target_roles: {
      archetypes: [
        { name: "Applied AI", level: "Staff", fit: "primary" },
        { name: "Platform", level: "Senior", fit: "secondary" },
      ],
    },
  });
  assert.equal(form.city, "Berlin");
  assert.equal(form.country, "Germany");
  assert.equal(form.workSetup, "hybrid");
  // seniority mirrors ONLY the first archetype's level.
  assert.equal(form.seniority, "Staff");
});

test("profileToForm blanks an out-of-enum work_setup so the form never renders a non-selectable option", () => {
  const form = profileToForm({ work_setup: "whenever" });
  assert.equal(form.workSetup, "");
});

test("profileToForm leaves the structured fields blank when absent", () => {
  const form = profileToForm({ candidate: { full_name: "Jane" } });
  assert.equal(form.city, "");
  assert.equal(form.country, "");
  assert.equal(form.workSetup, "");
  assert.equal(form.seniority, "");
});
