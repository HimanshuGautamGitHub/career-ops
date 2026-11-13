import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";
import * as yaml from "js-yaml";

const webSrc = fileURLToPath(new URL("../../src/", import.meta.url));
const loader = `
  import { existsSync } from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of [".ts", ".tsx", ".mjs", ".js", ""]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, pathToFileURL(webSrc));


const { POST } = await import("../../src/app/api/profile/route.ts");
const source = "# Original fixture comment\ncandidate:\n  full_name: Fixture Candidate\n  email: fixture@example.invalid\ncompensation:\n  currency: USD\n  target_range: 80-90\n";
async function fixture(t, body) {
  const root = mkdtempSync(path.join(tmpdir(), "profile-input-"));
  const previous = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  t.after(() => {
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const config = path.join(root, "config");
  mkdirSync(config);
  const file = path.join(config, "profile.yml");
  writeFileSync(file, source);
  const response = await POST(new Request("http://fixture.invalid/api/profile", {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  }));
  return { response, file, config };
}

for (const [name, body] of [
  ["null", "null"], ["array", "[]"], ["string", '"fixture"'],
  ["malformed JSON", "{"],
  ["string roles", '{"roles":"backend"}'],
  ["object name", '{"name":{"bad":"object"}}'],
  ["numeric email", '{"email":42}'],
  ["boolean location", '{"location":true}'],
  ["mixed roles", '{"roles":["Engineer",42]}'],
  ["null roles", '{"roles":null}'],
  ["string salary", '{"compMin":"100","compMax":200}'],
  ["infinite salary", '{"compMin":1e400,"compMax":200}'],
  ["negative salary", '{"compMin":-1,"compMax":200}'],
  ["reversed range", '{"compMin":200,"compMax":100}'],
  ["object currency", '{"currency":{}}'],
  ["array remote", '{"remote":[]}'],
  ["numeric city", '{"city":42}'],
  ["boolean country", '{"country":true}'],
  ["numeric workSetup", '{"workSetup":42}'],
  ["out-of-enum workSetup", '{"workSetup":"whenever"}'],
  ["object seniority", '{"seniority":{}}'],
]) {
  test(`${name} returns 400 without changing any files`, async (t) => {
    const { response, file, config } = await fixture(t, body);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
    assert.equal(readFileSync(file, "utf8"), source);
    assert.deepEqual(readdirSync(config), ["profile.yml"]);
  });
}

for (const bound of ["compMin", "compMax"]) {
  test(`a lone ${bound} is ignored while other profile updates are saved`, async (t) => {
    const { response, file, config } = await fixture(t, JSON.stringify({
      name: "Updated Fixture", [bound]: 100,
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(yaml.load(readFileSync(file, "utf8")), {
      candidate: { full_name: "Updated Fixture", email: "fixture@example.invalid" },
      compensation: { currency: "USD", target_range: "80-90" },
    });
    const backups = readdirSync(config).filter((f) => f.startsWith("profile.yml.bak-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(path.join(config, backups[0]), "utf8"), source);
  });
}

test("valid partial updates retain unrelated settings and exact-byte backup", async (t) => {
  const { response, file, config } = await fixture(t, JSON.stringify({
    name: "Updated Fixture", roles: ["Backend Engineer"], compMin: 100, compMax: 200,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(yaml.load(readFileSync(file, "utf8")), {
    candidate: { full_name: "Updated Fixture", email: "fixture@example.invalid" },
    target_roles: { primary: ["Backend Engineer"] },
    compensation: { currency: "USD", target_range: "100-200" },
  });
  const backups = readdirSync(config).filter((f) => f.startsWith("profile.yml.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(path.join(config, backups[0]), "utf8"), source);
});

test("city/country write the structured top-level location block; a valid work_setup writes the top-level key", async (t) => {
  const { response, file } = await fixture(t, JSON.stringify({
    city: "Berlin", country: "Germany", workSetup: "hybrid",
  }));
  assert.equal(response.status, 200);
  const written = yaml.load(readFileSync(file, "utf8"));
  assert.deepEqual(written.location, { city: "Berlin", country: "Germany" });
  assert.equal(written.work_setup, "hybrid");
  // The free-text candidate.location is left untouched — it is a different axis.
  assert.equal(written.candidate.location, undefined);
});

// seniority has no profile to edit here (the fixture has no archetypes), so it is
// a no-op field: on its own it is "nothing to write", never a fabricated archetype.
test("a seniority-only update with no existing archetypes is a 400 and writes nothing", async (t) => {
  const { response, file } = await fixture(t, JSON.stringify({ seniority: "Staff" }));
  assert.equal(response.status, 400);
  assert.equal(readFileSync(file, "utf8"), source);
});

test("seniority updates ONLY the first archetype's level, preserving the others and their fields", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "profile-seniority-"));
  const previous = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  t.after(() => {
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const config = path.join(root, "config");
  mkdirSync(config);
  const file = path.join(config, "profile.yml");
  writeFileSync(
    file,
    yaml.dump({
      candidate: { full_name: "Jane" },
      target_roles: {
        archetypes: [
          { name: "Applied AI", level: "Senior", fit: "primary" },
          { name: "Platform", level: "Senior", fit: "secondary" },
        ],
      },
    }),
  );
  const response = await POST(new Request("http://fixture.invalid/api/profile", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seniority: "Staff" }),
  }));
  assert.equal(response.status, 200);
  const written = yaml.load(readFileSync(file, "utf8"));
  assert.deepEqual(written.target_roles.archetypes, [
    { name: "Applied AI", level: "Staff", fit: "primary" },
    { name: "Platform", level: "Senior", fit: "secondary" },
  ]);
});
