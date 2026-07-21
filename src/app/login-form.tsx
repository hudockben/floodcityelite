"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="form" noValidate>
      <div className="field">
        <label htmlFor="companyCode">Company code</label>
        <input
          id="companyCode"
          name="companyCode"
          type="text"
          autoComplete="organization"
          placeholder="fce"
          defaultValue="fce"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          placeholder="Your username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          required
        />
      </div>

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
