// Single source for parsing the ADMIN_EMAILS secret.
//
// Admin identity in this project is the email on the `accounts` row matched
// against the ADMIN_EMAILS secret — there is no `is_admin` column by design
// (AGENT.md §7). The consequence: ANY self-service path that creates an
// `accounts` row with an admin address hands out full admin. So every signup
// path must refuse those addresses outright (SECURITY_PLAN P38).

/** Parse ADMIN_EMAILS into a normalized list. Tolerates spaces around commas. */
export function adminEmailList(env) {
  return (env?.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True if `email` is listed in ADMIN_EMAILS (trim + lowercase on both sides). */
export function isAdminEmail(env, email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return adminEmailList(env).includes(normalized);
}
