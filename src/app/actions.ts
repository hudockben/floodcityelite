"use server";

import { redirect } from "next/navigation";
import { authenticate } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";
import { currentTenant, isTenantLocked } from "@/lib/tenant";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  // On a deployment or domain dedicated to one organization the company code is
  // not the visitor's to choose: it is taken from the request, and whatever was
  // posted is ignored. That is what keeps someone else's code from working at
  // this address — and what lets the form stop asking for one at all.
  const locked = await isTenantLocked();
  const companyCode = locked
    ? (await currentTenant()).code
    : String(formData.get("companyCode") ?? "")
        .trim()
        .toLowerCase();

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!companyCode || !username || !password) {
    return { error: "Please fill in every field." };
  }

  let user;
  try {
    user = await authenticate(companyCode, username, password);
  } catch (err) {
    console.error("Login error:", err);
    return { error: "Something went wrong on our end. Please try again." };
  }

  if (!user) {
    // Name only the fields they can actually see. On a deployment of one
    // organization's own the company code is filled in server-side and the form
    // never shows it, so blaming it sends someone hunting for a field that
    // isn't on their screen.
    return {
      error: locked
        ? "Invalid username or password."
        : "Invalid company code, username, or password.",
    };
  }

  await createSession(user);
  // redirect() throws internally, so keep it outside the try/catch above.
  redirect("/homeplate");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
