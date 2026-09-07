"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { issueSession, isAdmin, ADMIN_COOKIE, ADMIN_MAX_AGE } from "@/lib/admin-auth";
import { updateOrderStatus } from "@/lib/orders";

export async function signIn(_prev: { error?: string } | undefined, formData: FormData) {
  const pass = String(formData.get("passphrase") ?? "");
  const session = issueSession(pass);
  if (!session) return { error: "That passphrase is not correct." };
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_MAX_AGE,
  });
  redirect("/admin/orders");
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  redirect("/admin");
}

export async function setStatus(formData: FormData) {
  // Re-checked here, not just in the proxy: a Server Action is its own
  // endpoint and must never trust that something upstream gated it.
  if (!(await isAdmin())) redirect("/admin");
  const id = String(formData.get("orderId") ?? "");
  const status = (formData.get("status") as string) || null;
  const payment = (formData.get("paymentStatus") as string) || null;
  await updateOrderStatus(id, status, payment);
  redirect("/admin/orders");
}
