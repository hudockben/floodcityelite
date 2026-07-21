import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import type { SessionUser } from "@/lib/session";

// A bcrypt hash of a random value that no real password will match. It is
// used to run a comparison even on the failure paths, so that "no such user"
// / "inactive account" cost the same wall-clock time as "wrong password" and
// cannot be told apart by measuring response latency (login enumeration).
const DUMMY_PASSWORD_HASH =
  "$2b$10$2WN6VZW8p.kDVeCJ59QgweIZeRgN/hW463.kSxcnhnbEu8oh6aF02";

/**
 * Verify a login. Returns the session user on success, or null when the
 * company code / username / password combination is invalid or the account
 * is inactive. The same null result is used for every failure mode so that
 * callers cannot distinguish "no such user" from "wrong password".
 */
export async function authenticate(
  companyCode: string,
  username: string,
  password: string,
): Promise<SessionUser | null> {
  const db = sql();

  const rows = await db`
    SELECT
      u.id            AS user_id,
      u.username      AS username,
      u.password_hash AS password_hash,
      u.full_name     AS full_name,
      u.role          AS role,
      u.is_active     AS is_active,
      c.id            AS company_id,
      c.code          AS company_code,
      c.name          AS company_name
    FROM users u
    JOIN companies c ON c.id = u.company_id
    WHERE c.code = ${companyCode}
      AND lower(u.username) = lower(${username})
    LIMIT 1
  `;

  const row =
    rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
  const active = row ? Boolean(row.is_active) : false;

  // Always run exactly one bcrypt comparison so every failure mode takes the
  // same amount of time. Use the real hash for an active user, otherwise a
  // fixed dummy hash that never matches.
  const hash = row && active ? String(row.password_hash) : DUMMY_PASSWORD_HASH;
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!row || !active || !passwordMatches) return null;

  await db`UPDATE users SET last_login_at = now() WHERE id = ${row.user_id as number}`;

  return {
    userId: row.user_id as number,
    companyId: row.company_id as number,
    companyCode: row.company_code as string,
    companyName: row.company_name as string,
    username: row.username as string,
    fullName: (row.full_name as string | null) ?? null,
    role: row.role as string,
  };
}
