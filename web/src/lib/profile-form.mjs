// Map a parsed config/profile.yml object back into the flat shape the
// Preferences form reads (GET /api/profile). The inverse of patchToProfile in
// the /api/profile POST handler: both must stay in sync so the form round-trips
// what it wrote. Pure — no I/O.

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v) {
  return typeof v === "string" ? v : "";
}

/**
 * Parse a comp range the web wrote (`"<min>-<max>"`, plain integers) into
 * numeric bounds. A range carrying letters/symbols ("$150K-200K") is left as
 * raw text so we never misrepresent magnitude by dropping a "K".
 *
 * @returns {{compMin: number|null, compMax: number|null, compRange: string}}
 */
function parseCompRange(raw) {
  const compRange = str(raw).trim();
  const m = compRange.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return { compMin: null, compMax: null, compRange };
  return { compMin: Number(m[1]), compMax: Number(m[2]), compRange };
}

/**
 * @param {unknown} obj Parsed profile.yml (or null/undefined when absent).
 * @returns {{name:string,email:string,location:string,roles:string[],compMin:number|null,compMax:number|null,compRange:string,currency:string,remote:string}}
 */
export function profileToForm(obj) {
  const root = isObj(obj) ? obj : {};
  const candidate = isObj(root.candidate) ? root.candidate : {};
  const comp = isObj(root.compensation) ? root.compensation : {};

  let roles = [];
  const targetRoles = root.target_roles;
  if (isObj(targetRoles)) {
    const primary = targetRoles.primary;
    if (Array.isArray(primary)) roles = primary.filter((r) => typeof r === "string");
    else if (typeof primary === "string" && primary.trim()) roles = [primary.trim()];
  }

  const { compMin, compMax, compRange } = parseCompRange(comp.target_range);

  return {
    name: str(candidate.full_name),
    email: str(candidate.email),
    location: str(candidate.location),
    roles,
    compMin,
    compMax,
    compRange,
    currency: str(comp.currency),
    remote: str(comp.location_flexibility),
  };
}
