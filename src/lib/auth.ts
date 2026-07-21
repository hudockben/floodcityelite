import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import type { SessionUser } from "@/lib/session";

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

  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;

  if (!row.is_active) return null;

  const ok = await bcrypt.compare(password, String(row.password_hash));
  if (!ok) return null;

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
