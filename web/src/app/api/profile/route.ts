import fs from "node:fs";
import { profilePatchError } from "@/lib/profile-patch.mjs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { isMapping } from "@/lib/portals-config.mjs";
import { firstProfileText, patchProfileText } from "@/lib/profile-yaml-edit.mjs";
import { profileToForm } from "@/lib/profile-form.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe writer for config/profile.yml (a USER-LAYER file — DATA_CONTRACT:
// never clobber the user's archetypes/narrative/proof-points). On first create we
// seed from config/profile.example.yml, without the person it describes; on an
// existing file we deep-merge ONLY the proposed keys, write atomically (temp +
// rename), and only ever via the confirm-gated setProfile action. The web
// orchestrates the real file — no parallel store.

type ProfilePatch = {
  name?: string;
  email?: string;
  location?: string;
  roles?: string[];
  compMin?: number;
  compMax?: number;
  currency?: string;
  remote?: string;
  city?: string; // writes location.city (structured location block)
  country?: string; // writes location.country (structured location block)
  workSetup?: string; // writes top-level work_setup ("remote" | "hybrid" | "onsite")
  seniority?: string; // writes target_roles.archetypes[0].level (additive, first archetype only)
};

// AGEN-249 contract: the three canonical work-setup values. A value outside this
// set is dropped rather than written, so the Explore/Schedule seeder never reads
// a non-enum work_setup out of profile.yml.
const WORK_SETUP_VALUES = ["remote", "hybrid", "onsite"] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Deep-merge src onto dst (objects recurse; arrays/scalars replace). Non-mutating. */
function deepMerge(dst: unknown, src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isObj(dst) ? { ...dst } : {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = isObj(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function patchToProfile(p: ProfilePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const candidate: Record<string, unknown> = {};
  if (p.name) candidate.full_name = p.name;
  if (p.email) candidate.email = p.email;
  if (p.location) candidate.location = p.location;
  if (Object.keys(candidate).length) out.candidate = candidate;
  if (p.roles?.length) out.target_roles = { primary: p.roles.slice(0, 6) };
  const comp: Record<string, unknown> = {};
  if (p.compMin && p.compMax) comp.target_range = `${p.compMin}-${p.compMax}`;
  if (p.currency) comp.currency = p.currency;
  if (p.remote) comp.location_flexibility = p.remote;
  if (Object.keys(comp).length) out.compensation = comp;
  // location — split city/country into the structured top-level location block
  // (candidate.location stays the free-text, backward-compat string above).
  const loc: Record<string, unknown> = {};
  if (p.city) loc.city = p.city;
  if (p.country) loc.country = p.country;
  if (Object.keys(loc).length) out.location = loc;
  // work_setup — top-level key, not nested under location or compensation.
  if (p.workSetup && (WORK_SETUP_VALUES as readonly string[]).includes(p.workSetup)) {
    out.work_setup = p.workSetup;
  }
  // seniority → target_roles.archetypes[0].level is applied in POST, where the
  // base profile is available: it updates the FIRST existing archetype's level
  // only and NEVER creates archetypes from scratch (that is onboard-write.mjs /
  // modes/_profile.md territory).
  return out;
}

// Read-only pre-fill for the Preferences form. Returns the flat field shape
// the form binds to (the inverse of patchToProfile), or blank defaults when no
// profile.yml exists yet. Never seeds or writes — that is POST's job alone.
export async function GET() {
  try {
    const file = getProfilePath(careerOpsRoot());
    if (!fs.existsSync(file)) {
      return Response.json({ profile: profileToForm(null) });
    }
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    return Response.json({ profile: profileToForm(parsed) });
  } catch {
    // A malformed profile must not break the settings screen — fall back to blanks.
    return Response.json({ profile: profileToForm(null) });
  }
}

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const error = profilePatchError(payload);
  if (error) return Response.json({ error }, { status: 400 });
  const proposed = patchToProfile(payload as ProfilePatch);
  // seniority writes nothing on its own (it edits an existing archetype, resolved
  // below once base is loaded), so defer the real "nothing to write" verdict until
  // after that. Reject here only when there is neither a direct field nor a
  // pending seniority edit.
  const seniority =
    typeof (payload as ProfilePatch).seniority === "string"
      ? (payload as ProfilePatch).seniority!.trim()
      : "";
  if (Object.keys(proposed).length === 0 && !seniority) {
    return Response.json({ error: "nothing to write" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const file = getProfilePath(root);
  let base: Record<string, unknown> = {};
  let source = "";
  let seeded = false;
  // DATA-LOSS GUARD (maintainer, bug-class #649/#704/#920/#958): distinguish
  // "no profile yet" (safe to seed from the example) from "profile EXISTS but is
  // malformed" (NEVER overwrite — that would silently destroy the user's data).
  if (!fs.existsSync(file)) {
    try {
      source = firstProfileText(fs.readFileSync(path.join(resolveCodeRoot(process.cwd(), process.env), "config", "profile.example.yml"), "utf8"));
      base = (yaml.load(source) as Record<string, unknown>) || {};
      seeded = Object.keys(base).length > 0;
    } catch {
      source = "";
      base = {};
    }
  } else {
    let parsed: unknown;
    try {
      source = fs.readFileSync(file, "utf8");
      parsed = yaml.load(source);
    } catch {
      return Response.json({ error: "config/profile.yml exists but is not valid YAML — refusing to overwrite it." }, { status: 409 });
    }
    // Valid YAML can still be a list, scalar, or null. Treating those as an
    // empty profile would discard the existing document on this partial write.
    if (!isMapping(parsed)) {
      return Response.json({ error: "config/profile.yml must contain named settings, not a list or single value. Refusing to overwrite it." }, { status: 409 });
    }
    base = parsed as Record<string, unknown>;
  }

  // seniority updates the FIRST existing archetype's level only — additive, and
  // never creates the archetypes block (AGEN-249: that is modes/_profile.md /
  // onboarding territory). Build the full array so the deep-merge below replaces
  // it wholesale without dropping the other archetypes or their name/fit fields.
  if (seniority) {
    const tr = isObj(base.target_roles) ? base.target_roles : null;
    const archetypes = tr && Array.isArray(tr.archetypes) ? tr.archetypes : null;
    if (archetypes && archetypes.length && isObj(archetypes[0])) {
      const updated = archetypes.map((a, i) => (i === 0 && isObj(a) ? { ...a, level: seniority } : a));
      const existingTarget = isObj(proposed.target_roles) ? proposed.target_roles : {};
      proposed.target_roles = { ...existingTarget, archetypes: updated };
    }
  }
  if (Object.keys(proposed).length === 0) {
    return Response.json({ error: "nothing to write" }, { status: 400 });
  }

  const merged = deepMerge(base, proposed);
  try {
    // Edit only the proposed keys' lines so the profile keeps its comments
    // (#5662). A shape the line edit cannot place falls back to yaml.dump,
    // which drops comments; the backup holds the prior bytes either way.
    const text =
      patchProfileText(source, proposed as Parameters<typeof patchProfileText>[1], merged) ??
      yaml.dump(merged, { lineWidth: 100, noRefs: true });
    atomicWriteWithBackup(file, text);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, seeded });
}
