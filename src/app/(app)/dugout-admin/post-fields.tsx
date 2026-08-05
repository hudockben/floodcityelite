"use client";

import { DIVISIONS } from "../teams/divisions";
// From lib/dugout-post, not lib/dugout: the latter imports the database client,
// which a client component would then ship to the browser.
import {
  DEFAULT_DUGOUT_CATEGORY,
  DUGOUT_BODY_MAX,
  DUGOUT_CATEGORIES,
  DUGOUT_TITLE_MAX,
} from "@/lib/dugout-post";

// The fields a post is made of, shared by the compose form and the inline
// editor so the two can never drift apart. `idPrefix` keeps the label/input ids
// unique when several editors are open at once; `post` supplies the values when
// editing (and nothing when writing a new one).
export type PostDefaults = {
  title: string;
  body: string;
  category: string;
  division: string | null;
  is_pinned: boolean;
  is_published: boolean;
};

export default function PostFields({
  idPrefix,
  post,
}: {
  idPrefix: string;
  post?: PostDefaults;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-title`}>Headline *</label>
        <input
          id={`${idPrefix}-title`}
          name="title"
          type="text"
          maxLength={DUGOUT_TITLE_MAX}
          placeholder="e.g. Saturday's games moved to Berkley Hills"
          defaultValue={post?.title ?? ""}
          required
        />
      </div>

      <div className="dugout-field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-category`}>Type</label>
          <select
            id={`${idPrefix}-category`}
            name="category"
            defaultValue={post?.category ?? DEFAULT_DUGOUT_CATEGORY}
          >
            {DUGOUT_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.mark} {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-division`}>Who it&apos;s for</label>
          <select
            id={`${idPrefix}-division`}
            name="division"
            defaultValue={post?.division ?? ""}
          >
            <option value="">Whole program</option>
            {DIVISIONS.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-visibility`}>Board status</label>
          <select
            id={`${idPrefix}-visibility`}
            name="visibility"
            defaultValue={post == null || post.is_published ? "posted" : "draft"}
          >
            {/* Short enough to read whole in the narrow compose column — the
                select is the width of one of three fields there. */}
            <option value="posted">Posted</option>
            <option value="draft">Draft (staff only)</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-body`}>Message *</label>
        <textarea
          id={`${idPrefix}-body`}
          name="body"
          rows={5}
          maxLength={DUGOUT_BODY_MAX}
          placeholder="What parents need to know. Line breaks are kept, so a list of times reads as a list."
          defaultValue={post?.body ?? ""}
          required
        />
      </div>

      <label className="dugout-pin-toggle" htmlFor={`${idPrefix}-pinned`}>
        <input
          id={`${idPrefix}-pinned`}
          name="is_pinned"
          type="checkbox"
          defaultChecked={post?.is_pinned ?? false}
        />
        <span>Pin to the top of the board</span>
      </label>
    </>
  );
}
