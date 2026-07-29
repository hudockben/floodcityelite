"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import ConfirmButton from "../teams/confirm-button";
import { formatCents } from "../budgets/budget";
import {
  addItemAction,
  deleteSectionAction,
  renameSectionAction,
  type FormState,
} from "./actions";
import ItemRow from "./item-row";
import {
  ITEM_NAME_MAX,
  SECTION_NAME_MAX,
  itemsTotalCents,
  perPlayerCents,
  type FixedCostItem,
  type FixedCostSection,
} from "./fixed-costs";

const initialState: FormState = {};

// One user-named section of the fixed-cost sheet: its line items, its subtotal,
// and what that subtotal works out to per player. The heading renames in place,
// and each section can be removed (taking its items with it).
export default function SectionCard({
  section,
  items,
  playerCount,
}: {
  section: FixedCostSection;
  items: FixedCostItem[];
  /** The count the whole tab divides by, for this section's per-player line. */
  playerCount: number;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameState, renameAction, renamePending] = useActionState(
    renameSectionAction,
    initialState,
  );
  const [addState, addAction, addPending] = useActionState(
    addItemAction,
    initialState,
  );
  const addFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (renameState?.ok) setRenaming(false);
  }, [renameState]);

  // Clear the add row on success so the next cost can be typed straight in.
  useEffect(() => {
    if (addState?.ok) addFormRef.current?.reset();
  }, [addState]);

  const subtotalCents = itemsTotalCents(items);
  const perPlayer = perPlayerCents(subtotalCents, playerCount);

  return (
    <section className="fx-section">
      <header className="fx-section-head">
        {renaming ? (
          <form action={renameAction} className="fx-rename-form">
            <input type="hidden" name="sectionId" value={section.id} />
            <label className="sr-only" htmlFor={`fx-section-${section.id}-name`}>
              Section name
            </label>
            <input
              id={`fx-section-${section.id}-name`}
              name="name"
              type="text"
              className="fx-input fx-input-name"
              defaultValue={section.name}
              maxLength={SECTION_NAME_MAX}
              required
              autoComplete="off"
            />
            <button type="submit" className="row-save" disabled={renamePending}>
              {renamePending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="row-delete"
              onClick={() => setRenaming(false)}
              disabled={renamePending}
            >
              Cancel
            </button>
            {renameState?.error ? (
              <p className="error fx-error" role="alert">
                {renameState.error}
              </p>
            ) : null}
          </form>
        ) : (
          <>
            <h3 className="fx-section-name">{section.name}</h3>
            <span className="fx-section-total">
              {formatCents(subtotalCents)}
              <span className="fx-section-per">
                {playerCount > 0
                  ? ` · ${formatCents(perPlayer)}/player`
                  : " · set a player count"}
              </span>
            </span>
            <div className="row-actions fx-section-actions">
              <button
                type="button"
                className="row-edit"
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
              {/* "Remove section", not "Remove": each line item below carries
                  its own Remove, and this one takes the whole group with it. */}
              <ConfirmButton
                action={deleteSectionAction}
                hidden={{ sectionId: section.id }}
                confirmText={`Remove "${section.name}" and its ${items.length} ${
                  items.length === 1 ? "cost" : "costs"
                }?`}
                className="row-delete"
              >
                Remove section
              </ConfirmButton>
            </div>
          </>
        )}
      </header>

      <table className="fx-table">
        <thead>
          <tr>
            <th>Cost</th>
            <th className="fx-amount">Amount</th>
            <th className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={3} className="fx-empty-row">
                Nothing in this section yet — add the first cost below.
              </td>
            </tr>
          ) : (
            items.map((item) => <ItemRow key={item.id} item={item} />)
          )}
        </tbody>
      </table>

      <form ref={addFormRef} action={addAction} className="fx-add-item">
        <input type="hidden" name="sectionId" value={section.id} />

        <label className="sr-only" htmlFor={`fx-add-${section.id}-name`}>
          Cost name
        </label>
        <input
          id={`fx-add-${section.id}-name`}
          name="name"
          type="text"
          className="fx-input fx-input-name"
          placeholder="e.g. Game jerseys"
          maxLength={ITEM_NAME_MAX}
          required
          autoComplete="off"
        />

        <div className="fx-money">
          <span className="fx-money-sign" aria-hidden="true">
            $
          </span>
          <label className="sr-only" htmlFor={`fx-add-${section.id}-amount`}>
            Amount
          </label>
          <input
            id={`fx-add-${section.id}-amount`}
            name="amount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className="fx-input fx-input-amount"
            placeholder="0.00"
            autoComplete="off"
          />
        </div>

        <button type="submit" className="btn-secondary fx-add-btn" disabled={addPending}>
          {addPending ? "Adding…" : "Add cost"}
        </button>

        {addState?.error ? (
          <p className="error fx-error" role="alert">
            {addState.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
