// Read / parse / serialize the user's do-not-apply list (data/blacklist.md).
//
// USER-LAYER FILE (DATA_CONTRACT in AGENTS.md): opt-in, never auto-populated,
// never clobbered by an update. The canonical on-disk shape is the markdown
// table `| Company | Since | Scope | Reason |`, matching templates/
// blacklist.example.md and the parser in scan.mjs (#1742). `Scope` is either
// `company` (match the feed-provided company label) or `domain` (match the
// posting URL hostname as a suffix). Pure string functions only — the API
// route owns the atomic file write.

const VALID_SCOPES = ["company", "domain"];

/** Normalize a scope cell to a known value; anything unknown falls back to `company`. */
function normalizeScope(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return VALID_SCOPES.includes(s) ? s : "company";
}

/**
 * Parse data/blacklist.md into an ordered list of entries.
 * First row wins on a duplicate company+scope; header and separator rows skipped.
 *
 * @param {string|null|undefined} text Raw blacklist.md content.
 * @returns {{company: string, since: string, scope: string, reason: string}[]}
 */
export function parseBlacklist(text) {
  const entries = [];
  const seen = new Set();
  for (const line of String(text ?? "").replace(/\r/g, "").split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((s) => s.trim());
    const company = cells[1] || "";
    if (!company || /^[-: ]+$/.test(company)) continue; // separator row
    if (company.toLowerCase() === "company") continue; // header row
    const scope = normalizeScope(cells[3]);
    const key = `${scope}:${company.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      company,
      since: cells[2] || "",
      scope,
      reason: cells[4] || "",
    });
  }
  return entries;
}

const TABLE_HEADER = "| Company | Since | Scope | Reason |";
const TABLE_SEPARATOR = "|---------|-------|-------|--------|";

const DEFAULT_PREAMBLE = `# Company Blacklist

Your own do-not-apply list (user layer, opt-in). The system never creates or
populates it for you, and no update ever touches it. \`scan.mjs\` skips postings
from listed companies; the \`auto-pipeline\`, \`oferta\`, and \`apply\` modes stop on
a match and ask for an explicit override. A blacklist entry never changes any
score — it is a gate, not a signal.

\`Scope\` is either \`company\` (match the feed-provided company label,
case- and punctuation-insensitively) or \`domain\` (match the posting URL's
hostname against the Company cell as a suffix, e.g. \`ibm.com\`).
`;

/** Render the markdown table block (header + separator + one row per entry). */
function renderTable(entries) {
  const rows = entries.map(
    (e) => `| ${e.company} | ${e.since || ""} | ${e.scope || "company"} | ${e.reason || ""} |`,
  );
  return [TABLE_HEADER, TABLE_SEPARATOR, ...rows].join("\n");
}

/**
 * Serialize entries back to blacklist.md, preserving any prose the user wrote
 * outside the table. The table region (the contiguous run of lines starting
 * with `|`) is replaced in place; everything before and after it is kept. When
 * there is no existing file, a standard preamble is written above the table.
 *
 * @param {{company:string,since:string,scope:string,reason:string}[]} entries
 * @param {string|null|undefined} existingText Current file content, if any.
 * @returns {string}
 */
export function serializeBlacklist(entries, existingText) {
  const table = renderTable(entries);
  const raw = String(existingText ?? "").replace(/\r/g, "");

  if (!raw.trim()) {
    return `${DEFAULT_PREAMBLE}\n${table}\n`;
  }

  const lines = raw.split("\n");
  const firstTable = lines.findIndex((l) => l.trim().startsWith("|"));

  if (firstTable === -1) {
    // Prose but no table yet — append one after a blank line.
    return `${raw.replace(/\n+$/, "")}\n\n${table}\n`;
  }

  let lastTable = firstTable;
  while (lastTable + 1 < lines.length && lines[lastTable + 1].trim().startsWith("|")) {
    lastTable++;
  }
  const before = lines.slice(0, firstTable);
  const after = lines.slice(lastTable + 1);
  const rebuilt = [...before, ...table.split("\n"), ...after].join("\n");
  return rebuilt.endsWith("\n") ? rebuilt : `${rebuilt}\n`;
}

/** Match two entries by scope + case-insensitive company. */
function sameEntry(a, companyLower, scope) {
  return a.scope === scope && a.company.toLowerCase() === companyLower;
}

/**
 * Add a new entry or replace the existing one keyed on company+scope
 * (case-insensitive). Non-mutating.
 */
export function upsertBlacklistEntry(entries, entry) {
  const scope = normalizeScope(entry.scope);
  const next = {
    company: String(entry.company || "").trim(),
    since: String(entry.since || "").trim(),
    scope,
    reason: String(entry.reason || "").trim(),
  };
  const companyLower = next.company.toLowerCase();
  const idx = entries.findIndex((e) => sameEntry(e, companyLower, scope));
  if (idx === -1) return [...entries, next];
  return entries.map((e, i) => (i === idx ? next : e));
}

/** Remove the entry matching company+scope (case-insensitive). Non-mutating. */
export function removeBlacklistEntry(entries, company, scope) {
  const companyLower = String(company || "").trim().toLowerCase();
  const s = normalizeScope(scope);
  return entries.filter((e) => !sameEntry(e, companyLower, s));
}

/**
 * Validate an untrusted entry before writing it to the table.
 * @returns {string|null} An actionable error, or null when valid.
 */
export function blacklistEntryError(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return "blacklist entry must be an object";
  }
  const company = typeof entry.company === "string" ? entry.company.trim() : "";
  if (!company) return "company is required";
  if (entry.scope != null && !VALID_SCOPES.includes(String(entry.scope).toLowerCase())) {
    return "scope must be 'company' or 'domain'";
  }
  for (const field of ["company", "since", "reason"]) {
    const v = entry[field];
    if (v != null && typeof v !== "string") return `${field} must be a string`;
    if (typeof v === "string" && v.includes("|")) {
      return `${field} must not contain a '|' character (it would corrupt the table)`;
    }
    // A newline would split one entry across rows and desync the table; the
    // parser reads each row as a single line, so reject it at the boundary too.
    if (typeof v === "string" && /[\n\r]/.test(v)) {
      return `${field} must not contain a line break (it would corrupt the table)`;
    }
  }
  return null;
}
