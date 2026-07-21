"use server";

import { redirect } from "next/navigation";
import { authenticate } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const companyCode = String(formData.get("companyCode") ?? "")
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
    return { error: "Invalid company code, username, or password." };
  }

  await createSession(user);
  // redirect() throws internally, so keep it outside the try/catch above.
  redirect("/homeplate");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
