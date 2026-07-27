"use server";

import {
  ensurePayrollSchema,
  getPayrollCompanyId,
  insertPayrollSubmission,
} from "@/lib/payroll";
import { isDivisionSlug } from "@/app/(app)/teams/divisions";

export type PayrollFormState = { ok?: boolean; error?: string };

// Trim a form value; return null when it's empty (for optional columns).
function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

// work_date comes from an <input type="date"> as "YYYY-MM-DD" (or empty).
function isoDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Handle a public employee payroll submission. No session — anyone with the
// link (from the Payroll card on the login screen) can log their hours.
export async function submitPayrollAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const employeeName = text(formData, "employee_name");
  if (!employeeName) return { error: "Enter your name." };

  const workDate = isoDate(formData.get("work_date"));
  if (!workDate) return { error: "Pick the date you worked." };

  const hoursNum = Number(String(formData.get("hours") ?? "").trim());
  if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
    return { error: "Enter the hours you worked (greater than zero)." };
  }
  // NUMERIC(6,2) caps the value at 9,999.99; keep two decimals.
  if (hoursNum > 9_999.99) return { error: "That's more hours than we can record." };
  const hours = hoursNum.toFixed(2);

  // Division is optional; keep it only when it's a real division slug.
  const rawDivision = String(formData.get("division") ?? "").trim();
  const division = isDivisionSlug(rawDivision) ? rawDivision : null;

  try {
    await ensurePayrollSchema();

    const companyId = await getPayrollCompanyId();
    if (companyId == null) {
      // The company row is missing (database hasn't been set up yet).
      return { error: "Payroll isn't set up yet. Please check back soon." };
    }

    await insertPayrollSubmission({
      companyId,
      employeeName: employeeName.slice(0, 160),
      role: text(formData, "role")?.slice(0, 120) ?? null,
      division,
      workDate,
      hours,
      notes: text(formData, "notes"),
    });
  } catch (err) {
    console.error("submitPayroll error:", err);
    return { error: "Could not submit your hours. Please try again." };
  }

  return { ok: true };
}
