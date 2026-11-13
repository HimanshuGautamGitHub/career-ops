"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";

// Preferences / Settings form over config/profile.yml (a USER-LAYER file).
// Reads the current values through GET /api/profile (flattened by
// profileToForm) and writes only the fields it owns back through POST
// /api/profile, which deep-merges them — the user's archetypes, narrative, and
// proof points are never touched. Comp bounds are sent only when both are valid
// so a half-filled range can never overwrite a real one.

type Form = {
  name: string;
  email: string;
  location: string;
  roles: string[];
  compMin: number | null;
  compMax: number | null;
  compRange: string;
  currency: string;
  remote: string;
};

const EMPTY: Form = {
  name: "",
  email: "",
  location: "",
  roles: [],
  compMin: null,
  compMax: null,
  compRange: "",
  currency: "",
  remote: "",
};

const MAX_ROLES = 6;

const LABEL = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-muted";
const INPUT =
  "w-full rounded-xl border border-border bg-surface/50 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-faint focus:border-brand/50 max-sm:min-h-[44px]";

function numOrEmpty(v: number | null): string {
  return v == null ? "" : String(v);
}

export function PreferencesSection() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [roleDraft, setRoleDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.profile) setForm({ ...EMPTY, ...d.profile });
      })
      .catch(() => {
        /* keep blank defaults — a missing profile is a valid first-run state */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function addRole() {
    const role = roleDraft.trim();
    if (!role) return;
    if (form.roles.some((r) => r.toLowerCase() === role.toLowerCase())) {
      setRoleDraft("");
      return;
    }
    if (form.roles.length >= MAX_ROLES) {
      setError(`Up to ${MAX_ROLES} target roles.`);
      return;
    }
    setForm((prev) => ({ ...prev, roles: [...prev.roles, role] }));
    setRoleDraft("");
    setSaved(false);
    setError(null);
  }

  function removeRole(role: string) {
    setForm((prev) => ({ ...prev, roles: prev.roles.filter((r) => r !== role) }));
    setSaved(false);
  }

  function onRoleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addRole();
    } else if (e.key === "Backspace" && !roleDraft && form.roles.length) {
      removeRole(form.roles[form.roles.length - 1]);
    }
  }

  async function save() {
    setError(null);

    // Build the patch the POST handler understands. Only non-empty fields are
    // sent; patchToProfile ignores blanks, so an empty box never clears a value.
    const patch: Record<string, unknown> = {};
    if (form.name.trim()) patch.name = form.name.trim();
    if (form.email.trim()) patch.email = form.email.trim();
    if (form.location.trim()) patch.location = form.location.trim();
    if (form.roles.length) patch.roles = form.roles;
    if (form.currency.trim()) patch.currency = form.currency.trim();
    if (form.remote.trim()) patch.remote = form.remote.trim();

    // Comp bounds travel as a pair only. The POST writer needs both to form
    // "<min>-<max>"; sending one alone would be dropped, so validate together.
    const hasMin = form.compMin != null;
    const hasMax = form.compMax != null;
    if (hasMin !== hasMax) {
      setError("Enter both a minimum and a maximum salary, or leave both blank.");
      return;
    }
    if (hasMin && hasMax) {
      if (!(form.compMin! > 0) || !(form.compMax! > 0)) {
        setError("Salary bounds must be positive numbers.");
        return;
      }
      if (form.compMin! > form.compMax!) {
        setError("Minimum salary must not exceed the maximum.");
        return;
      }
      patch.compMin = form.compMin;
      patch.compMax = form.compMax;
    }

    if (Object.keys(patch).length === 0) {
      setError("Nothing to save yet — fill in a field first.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Could not save your preferences.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="preferences-heading" className="mt-10">
      <h2
        id="preferences-heading"
        className="text-xs font-semibold uppercase tracking-[0.18em] text-muted"
      >
        Preferences
      </h2>
      <p className="mt-1 mb-4 text-xs text-faint">
        Who you are and what you&apos;re targeting. Saved to your profile on this computer and used
        to score and tailor every job.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading your profile…
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pref-name" className={LABEL}>
                Full name
              </label>
              <input
                id="pref-name"
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Jane Smith"
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="pref-email" className={LABEL}>
                Email
              </label>
              <input
                id="pref-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="jane@example.com"
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label htmlFor="pref-location" className={LABEL}>
              Location
            </label>
            <input
              id="pref-location"
              type="text"
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="City, Country"
              className={INPUT}
            />
          </div>

          <div>
            <label htmlFor="pref-roles" className={LABEL}>
              Target roles
            </label>
            {form.roles.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-2">
                {form.roles.map((role) => (
                  <li
                    key={role}
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand/50 bg-brand-soft px-3 py-1 text-sm text-foreground"
                  >
                    {role}
                    <button
                      type="button"
                      onClick={() => removeRole(role)}
                      aria-label={`Remove ${role}`}
                      className="text-muted transition-colors hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              id="pref-roles"
              type="text"
              value={roleDraft}
              onChange={(e) => setRoleDraft(e.target.value)}
              onKeyDown={onRoleKeyDown}
              onBlur={addRole}
              placeholder="Senior Backend Engineer — press Enter to add"
              aria-describedby="pref-roles-hint"
              className={INPUT}
            />
            <p id="pref-roles-hint" className="mt-1 text-xs text-faint">
              Up to {MAX_ROLES}. Press Enter or comma to add each one.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="pref-comp-min" className={LABEL}>
                Salary min
              </label>
              <input
                id="pref-comp-min"
                type="number"
                min={0}
                inputMode="numeric"
                value={numOrEmpty(form.compMin)}
                onChange={(e) =>
                  set("compMin", e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder="150000"
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="pref-comp-max" className={LABEL}>
                Salary max
              </label>
              <input
                id="pref-comp-max"
                type="number"
                min={0}
                inputMode="numeric"
                value={numOrEmpty(form.compMax)}
                onChange={(e) =>
                  set("compMax", e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder="200000"
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="pref-currency" className={LABEL}>
                Currency
              </label>
              <input
                id="pref-currency"
                type="text"
                value={form.currency}
                onChange={(e) => set("currency", e.target.value)}
                placeholder="USD"
                className={INPUT}
              />
            </div>
          </div>

          {form.compRange && form.compMin == null && form.compMax == null && (
            <p className="-mt-2 text-xs text-faint">
              Your saved range is{" "}
              <span className="text-muted">{form.compRange}</span>. Enter numeric bounds above to
              replace it.
            </p>
          )}

          <div>
            <label htmlFor="pref-remote" className={LABEL}>
              Remote preference
            </label>
            <input
              id="pref-remote"
              type="text"
              value={form.remote}
              onChange={(e) => set("remote", e.target.value)}
              placeholder="Remote preferred, hybrid in Berlin, on-site OK…"
              className={INPUT}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60 max-sm:min-h-[44px]",
              )}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
              {saving ? "Saving…" : saved ? "Saved" : "Save preferences"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
