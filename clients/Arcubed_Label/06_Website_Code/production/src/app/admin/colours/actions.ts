"use server";

// Server Actions for the colour workflow. Each one re-checks the admin
// session itself (a Server Action is its own endpoint and must never trust
// that the page that rendered it was gated), validates its input, and calls
// src/lib/colour-workflow.ts, which holds the rules.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import * as wf from "@/lib/colour-workflow";

export type Result = { ok: true } | { ok: false; error: string };

async function guard<T>(fn: () => Promise<T>, paths: string[] = []): Promise<Result> {
  if (!(await isAdmin())) redirect("/admin");
  try {
    await fn();
    for (const p of ["/admin/colours", ...paths]) revalidatePath(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

const id = (v: unknown) => {
  const s = String(v ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error("Invalid id.");
  return s;
};

export async function createColour(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin");
  let newId = "";
  try {
    newId = await wf.createCandidate(String(formData.get("name") ?? ""), String(formData.get("material") ?? "") as wf.Material);
  } catch (e) {
    redirect(`/admin/colours?error=${encodeURIComponent(e instanceof Error ? e.message : "Could not add the colour.")}`);
  }
  revalidatePath("/admin/colours");
  redirect(`/admin/colours/${newId}`);
}

export async function saveReference(candidateId: string, image: string, measurement: wf.Measurement, measuredHex: string) {
  return guard(() => wf.saveReference(id(candidateId), image, measurement, measuredHex), [`/admin/colours/${candidateId}`]);
}

export async function saveCalibration(candidateId: string, calibration: wf.Calibration, hex: string) {
  return guard(() => wf.saveCalibration(id(candidateId), calibration, hex), [`/admin/colours/${candidateId}`]);
}

export async function saveBags(candidateId: string, slugs: string[]) {
  return guard(() => wf.saveBags(id(candidateId), slugs.map(String)), [`/admin/colours/${candidateId}`]);
}

export async function submitForReview(candidateId: string) {
  return guard(() => wf.submitForReview(id(candidateId)), [`/admin/colours/${candidateId}`]);
}

export async function approveColour(candidateId: string, approvedBy: string, note: string) {
  return guard(() => wf.approve(id(candidateId), String(approvedBy), String(note ?? "")), [`/admin/colours/${candidateId}`]);
}

export async function rejectColour(candidateId: string, note: string) {
  return guard(() => wf.reject(id(candidateId), String(note ?? "")), [`/admin/colours/${candidateId}`]);
}

export async function setSupplierConfirmed(candidateId: string, confirmed: boolean, note: string) {
  return guard(() => wf.setSupplier(id(candidateId), Boolean(confirmed), String(note ?? "")), [`/admin/colours/${candidateId}`]);
}

export async function publishColour(candidateId: string) {
  // The shop's product and catalogue pages are rendered per request
  // (force-dynamic), so they read the new colour on the next visit.
  return guard(() => wf.publish(id(candidateId)), [`/admin/colours/${candidateId}`]);
}

export async function setColourAvailability(productId: string, colourId: string, active: boolean) {
  return guard(() => wf.setAvailability(id(productId), id(colourId), Boolean(active)));
}

export async function deleteColour(candidateId: string) {
  if (!(await isAdmin())) redirect("/admin");
  try {
    await wf.removeCandidate(id(candidateId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete." } as Result;
  }
  revalidatePath("/admin/colours");
  redirect("/admin/colours");
}
