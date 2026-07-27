"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  deletePayrollSubmission,
  updatePayrollStatus,
  isPayrollStatus,
} from "@/lib/payroll";

// Set a submission's approval status — the admin approving/denying the time.
// Called directly from the inline dropdown (see PayrollStatusSelect).
export async function updatePayrollStatusAction(input: {
  id: number;
  status: string;
}): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const id = Number(input.id);
  if (!Number.isFinite(id)) return;
  if (!isPayrollStatus(input.status)) return;

  await updatePayrollStatus(session.companyId, id, input.status);

  revalidatePath("/payroll-admin");
  revalidatePath("/payroll-admin/reports");
}

// Remove a payroll submission once the office has processed it. Scoped to the
// signed-in admin's company.
export async function deletePayrollSubmissionAction(
  formData: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return;

  await deletePayrollSubmission(session.companyId, id);

  revalidatePath("/payroll-admin");
  revalidatePath("/payroll-admin/reports");
}
