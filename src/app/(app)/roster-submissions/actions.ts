"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { deleteRosterSubmission } from "@/lib/roster-submissions";

// Remove a roster submission once the office has processed it. Scoped to the
// signed-in admin's company. Any roster row an acceptance created stays put —
// deleting the submission doesn't remove the player from the team.
export async function deleteRosterSubmissionAction(
  formData: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return;

  await deleteRosterSubmission(session.companyId, id);

  revalidatePath("/roster-submissions");
}
