// Formats a run's captured role identities (JobRun.roles) for display.
// Records written before this feature carry no `roles` field; those render
// count-only, so this returns an empty list for anything that is not a
// well-formed, non-empty role array.
export function formatRunRoles(run) {
  const roles = run && Array.isArray(run.roles) ? run.roles : [];
  const formatted = [];
  for (const role of roles) {
    if (!role || typeof role !== "object") continue;
    const title = typeof role.title === "string" ? role.title.trim() : "";
    if (!title) continue;
    const company = typeof role.company === "string" ? role.company.trim() : "";
    const url = typeof role.url === "string" && role.url.trim() ? role.url.trim() : undefined;
    formatted.push({ label: company ? `${title} — ${company}` : title, url });
  }
  return formatted;
}
