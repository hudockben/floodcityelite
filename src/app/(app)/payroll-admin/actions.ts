"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { deletePayrollSubmission } from "@/lib/payroll";

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
}
