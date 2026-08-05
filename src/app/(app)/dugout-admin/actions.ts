"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { isDivisionSlug } from "../teams/divisions";
import {
  DEFAULT_DUGOUT_CATEGORY,
  DUGOUT_BODY_MAX,
  DUGOUT_TITLE_MAX,
  deleteDugoutPost,
  ensureDugoutSchema,
  insertDugoutPost,
  isDugoutCategory,
  setDugoutPostPinned,
  setDugoutPostPublished,
  updateDugoutPost,
} from "@/lib/dugout";

// ---------------------------------------------------------------------------
// The Dugout — admin actions
//
// Every action here starts with `getSession()` and scopes its write to that
// session's company. That check is the feature: parents read the board at
// /dugout with no account, and there is no path from that page into any of
// these. A post exists because somebody signed in and wrote it.
// ---------------------------------------------------------------------------

export type DugoutFormState = { ok?: boolean; error?: string };

// Both the public board and the admin tab render from the same rows, so a write
// has to refresh both — an unpinned post that stays pinned for parents until
// something else happens to rebuild the page is worse than no pin at all.
function revalidateBoard(): void {
  revalidatePath("/dugout-admin");
  revalidatePath("/dugout");
}

// The fields the compose and edit forms share. Returns the validated values, or
// the message to show above the form.
function readPost(
  formData: FormData,
):
  | { ok: true; value: {
      title: string;
      body: string;
      category: string;
      division: string | null;
      isPinned: boolean;
      isPublished: boolean;
    } }
  | { ok: false; error: string } {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "Give the post a title." };
  if (title.length > DUGOUT_TITLE_MAX) {
    return { ok: false, error: `Titles are limited to ${DUGOUT_TITLE_MAX} characters.` };
  }

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { ok: false, error: "Write the message parents will read." };
  if (body.length > DUGOUT_BODY_MAX) {
    return {
      ok: false,
      error: `That's longer than the board holds (${DUGOUT_BODY_MAX} characters). Trim it or split it into two posts.`,
    };
  }

  // Anything we don't recognise falls back to Announcement rather than failing
  // the write — the category is how a post is labelled, not what it says.
  const rawCategory = String(formData.get("category") ?? "").trim();
  const category = isDugoutCategory(rawCategory)
    ? rawCategory
    : DEFAULT_DUGOUT_CATEGORY;

  // Division is optional: blank means the post is for the whole program.
  const rawDivision = String(formData.get("division") ?? "").trim();
  const division = isDivisionSlug(rawDivision) ? rawDivision : null;

  return {
    ok: true,
    value: {
      title,
      body,
      category,
      division,
      isPinned: formData.get("is_pinned") != null,
      // The form posts "draft" or "posted"; anything else is treated as a draft,
      // so a malformed value can never put a half-written note in front of
      // parents.
      isPublished: String(formData.get("visibility") ?? "") === "posted",
    },
  };
}

// Put a new post on the board.
export async function createDugoutPostAction(
  _prev: DugoutFormState,
  formData: FormData,
): Promise<DugoutFormState> {
  const session = await getSession();
  if (!session) return { error: "Your session expired. Sign in again to post." };

  const parsed = readPost(formData);
  if (!parsed.ok) return { error: parsed.error };

  try {
    await ensureDugoutSchema();
    await insertDugoutPost({
      companyId: session.companyId,
      ...parsed.value,
      authorName: session.fullName || session.username,
    });
  } catch (err) {
    console.error("createDugoutPost error:", err);
    return { error: "Could not post that. Please try again." };
  }

  revalidateBoard();
  return { ok: true };
}

// Edit a post that's already up.
export async function updateDugoutPostAction(
  _prev: DugoutFormState,
  formData: FormData,
): Promise<DugoutFormState> {
  const session = await getSession();
  if (!session) return { error: "Your session expired. Sign in again to edit." };

  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return { error: "That post could not be found." };

  const parsed = readPost(formData);
  if (!parsed.ok) return { error: parsed.error };

  try {
    await ensureDugoutSchema();
    await updateDugoutPost(session.companyId, id, parsed.value);
  } catch (err) {
    console.error("updateDugoutPost error:", err);
    return { error: "Could not save that change. Please try again." };
  }

  revalidateBoard();
  return { ok: true };
}

// Pin a post to the top of the board, or take it back down. The button posts
// the state it wants, so a double-click can't toggle it back and forth.
export async function setDugoutPinnedAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return;

  await setDugoutPostPinned(
    session.companyId,
    id,
    String(formData.get("pinned") ?? "") === "1",
  );
  revalidateBoard();
}

// Publish a draft, or pull a post back off the board so parents stop seeing it.
export async function setDugoutPublishedAction(
  formData: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return;

  await setDugoutPostPublished(
    session.companyId,
    id,
    String(formData.get("published") ?? "") === "1",
  );
  revalidateBoard();
}

// Delete a post for good.
export async function deleteDugoutPostAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return;

  await deleteDugoutPost(session.companyId, id);
  revalidateBoard();
}
