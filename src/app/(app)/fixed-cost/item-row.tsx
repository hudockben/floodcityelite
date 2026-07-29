"use client";

import { useActionState, useEffect, useState } from "react";
import ConfirmButton from "../teams/confirm-button";
import { amountToCents, formatCents } from "../budgets/budget";
import { deleteItemAction, updateItemAction, type FormState } from "./actions";
import { ITEM_NAME_MAX, type FixedCostItem } from "./fixed-costs";

const initialState: FormState = {};

// One fixed-cost line item. Reads as a row of the section's sheet until Edit
// turns the name and amount into inputs in place.
export default function ItemRow({ item }: { item: FixedCostItem }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateItemAction,
    initialState,
  );

  // Collapse the editor once a save succeeds (revalidation brings the new
  // values, and the section subtotal above it, back down).
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (editing) {
    return (
      <tr className="fx-edit-row">
        <td colSpan={3}>
          <form action={formAction} className="fx-edit-form">
            <input type="hidden" name="itemId" value={item.id} />

            <label className="sr-only" htmlFor={`fx-item-${item.id}-name`}>
              Cost name
            </label>
            <input
              id={`fx-item-${item.id}-name`}
              name="name"
              type="text"
              className="fx-input fx-input-name"
              defaultValue={item.name}
              maxLength={ITEM_NAME_MAX}
              required
              autoComplete="off"
            />

            <div className="fx-money">
              <span className="fx-money-sign" aria-hidden="true">
                $
              </span>
              <label className="sr-only" htmlFor={`fx-item-${item.id}-amount`}>
                Amount
              </label>
              <input
                id={`fx-item-${item.id}-amount`}
                name="amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className="fx-input fx-input-amount"
                defaultValue={
                  item.amount == null ? "" : String(Number(item.amount))
                }
                placeholder="0.00"
                autoComplete="off"
              />
            </div>

            <div className="fx-edit-actions">
              <button type="submit" className="row-save" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="row-delete"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </button>
            </div>

            {state?.error ? (
              <p className="error fx-error" role="alert">
                {state.error}
              </p>
            ) : null}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="fx-name">{item.name}</td>
      <td className="fx-amount">{formatCents(amountToCents(item.amount))}</td>
      <td className="col-actions">
        <div className="row-actions">
          <button
            type="button"
            className="row-edit"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <ConfirmButton
            action={deleteItemAction}
            hidden={{ itemId: item.id }}
            confirmText={`Remove "${item.name}" from this section?`}
            className="row-delete"
          >
            Remove
          </ConfirmButton>
        </div>
      </td>
    </tr>
  );
}
