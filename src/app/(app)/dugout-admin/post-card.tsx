"use client";

import { useActionState, useEffect, useState } from "react";
import ConfirmButton from "../teams/confirm-button";
import { divisionLabel } from "../teams/divisions";
// From lib/dugout-post, not lib/dugout: the latter imports the database client,
// which a client component would then ship to the browser.
import { dugoutCategory } from "@/lib/dugout-post";
import {
  deleteDugoutPostAction,
  setDugoutPinnedAction,
  setDugoutPublishedAction,
  updateDugoutPostAction,
  type DugoutFormState,
} from "./actions";
import PostFields from "./post-fields";

const initialState: DugoutFormState = {};

// The admin's view of one post: the card as parents see it, plus the controls
// only staff get — pin, draft/post, edit, delete. A draft is shown here (it is
// the staff's own copy) and marked as one, since the whole difference between a
// draft and a post is whether families can see it.
export type AdminPost = {
  id: number;
  title: string;
  body: string;
  category: string;
  division: string | null;
  is_pinned: boolean;
  is_published: boolean;
  author_name: string | null;
  posted_on: string;
  edited: boolean;
};

export default function PostCard({ post }: { post: AdminPost }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateDugoutPostAction,
    initialState,
  );

  // Collapse the editor once a save succeeds — the revalidated page brings the
  // updated card back.
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  const category = dugoutCategory(post.category);

  if (editing) {
    return (
      <li className="dugout-post is-editing">
        <form action={formAction} className="dugout-compose">
          <input type="hidden" name="id" value={post.id} />

          <div className="player-edit-head">
            Editing <strong>{post.title}</strong>
          </div>

          <PostFields idPrefix={`dugout-edit-${post.id}`} post={post} />

          <div className="player-form-actions">
            <button type="submit" className="btn" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancel
            </button>
            {state?.error ? (
              <p className="error player-form-msg" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li
      className={`dugout-post${post.is_pinned ? " is-pinned" : ""}${
        post.is_published ? "" : " is-draft"
      }`}
    >
      <div className="dugout-post-tags">
        {post.is_pinned ? (
          <span className="dugout-tag dugout-tag-pinned">
            <span aria-hidden="true">📌</span> Pinned
          </span>
        ) : null}
        {post.is_published ? null : (
          <span className="dugout-tag dugout-tag-draft">Draft</span>
        )}
        <span className="dugout-tag">
          <span aria-hidden="true">{category.mark}</span> {category.label}
        </span>
        <span className="dugout-tag dugout-tag-scope">
          {post.division ? divisionLabel(post.division) : "Whole program"}
        </span>
      </div>

      <h3 className="dugout-post-title">{post.title}</h3>

      <p className="dugout-post-meta">
        {post.posted_on}
        {post.author_name ? ` · ${post.author_name}` : ""}
        {post.edited ? " · edited" : ""}
      </p>

      <p className="dugout-post-body">{post.body}</p>

      <div className="dugout-post-actions">
        {/* Each toggle posts the state it wants rather than "flip it", so a
            double-click lands on the same answer twice instead of undoing
            itself. */}
        <form action={setDugoutPinnedAction}>
          <input type="hidden" name="id" value={post.id} />
          <input type="hidden" name="pinned" value={post.is_pinned ? "0" : "1"} />
          <button type="submit" className="row-edit">
            {post.is_pinned ? "Unpin" : "Pin to top"}
          </button>
        </form>

        <form action={setDugoutPublishedAction}>
          <input type="hidden" name="id" value={post.id} />
          <input
            type="hidden"
            name="published"
            value={post.is_published ? "0" : "1"}
          />
          <button type="submit" className="row-edit">
            {post.is_published ? "Move to drafts" : "Post to the board"}
          </button>
        </form>

        <button
          type="button"
          className="row-edit"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>

        <ConfirmButton
          action={deleteDugoutPostAction}
          hidden={{ id: post.id }}
          confirmText={`Delete "${post.title}" from the board?`}
          className="row-delete"
        >
          Delete
        </ConfirmButton>
      </div>
    </li>
  );
}
