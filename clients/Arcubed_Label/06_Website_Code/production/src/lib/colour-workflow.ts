import "server-only";

// The colour workflow (admin /admin/colours): Rand's supplier yarns, from a
// reference photograph to a published, orderable colour. Server-only: every
// call uses the service-role client, and every caller is an admin Server
// Action or admin page that has checked the session itself.
//
//   draft ──submit──▶ in_review ──approve──▶ approved ──publish──▶ (orderable)
//     ▲                   │                     │
//     └──── any edit ◀────┴──── reject ◀────────┘
//
// Rules this module enforces (the database enforces the critical ones again):
//   · uploading or calibrating NEVER makes a colour orderable
//   · approval and publication are separate actions
//   · publication needs: approved + supplier confirmed + at least one bag
//   · a colour can only go on bags of its own material, and only where the
//     bag's photograph can show it (Loco: nothing lighter than L* 45)
//   · editing an approved colour withdraws the approval (a published colour
//     stays live, unchanged, until it is approved and published again)

import { createAdminClient } from "./supabase/admin";
import type { Database, Json } from "./supabase/types";
import { familyOf } from "./recolour/data";
import { PREVIEW_SOURCES } from "./recolour/preview-colours";
import { srgbToLab, hexToRgb } from "./recolour/engine";

export const MATERIALS = {
  "metallic-raffia": "Metallic raffia",
  "matte-cord": "Matte cord",
  "fringe-cord": "Fringe cord",
} as const;
export type Material = keyof typeof MATERIALS;
export type CandidateStatus = "draft" | "in_review" | "approved" | "rejected";

export interface Calibration { dL: number; chroma: number; hue: number }
export interface Measurement { x: number; y: number; w: number; h: number; lab: [number, number, number]; pixels: number }

export interface Candidate {
  id: string;
  name: string;
  material: Material;
  referenceImage: string | null;
  measurement: Measurement | null;
  measuredHex: string | null;
  hex: string | null;
  calibration: Calibration;
  bags: string[];
  status: CandidateStatus;
  reviewNote: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  supplierConfirmed: boolean;
  supplierNote: string | null;
  publishedColourId: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface BagInfo { id: string; slug: string; name: string; material: Material | null; maxLightness: number | null }
export interface CatalogueEntry { productId: string; colourId: string; colourName: string; hex: string | null; active: boolean; isTwoTone: boolean }

const HEX = /^#[0-9a-f]{6}$/;
const BAG_ORDER = ["nova", "mini-luna", "vault", "loco"];

/** True when the colour workflow's table exists in this database (the
 *  migration 20261015180000_colour_workflow.sql has been applied). */
export async function workflowAvailable(): Promise<boolean> {
  const { error } = await createAdminClient().from("colour_candidates").select("id", { head: true, count: "exact" });
  if (!error) return true;
  if (error.code === "PGRST205" || error.code === "42P01" || /colour_candidates/.test(error.message)) return false;
  throw new Error(error.message);
}

type Row = {
  id: string; name: string; material_family: string; reference_image?: string | null; measurement: unknown; measured_hex: string | null;
  hex_value: string | null; calibration: unknown; product_slugs: string[]; status: string; review_note: string | null;
  approved_by: string | null; approved_at: string | null; supplier_confirmed: boolean; supplier_note: string | null;
  published_colour_id: string | null; published_at: string | null; updated_at: string;
};

function toCandidate(r: Row): Candidate {
  return {
    id: r.id, name: r.name, material: r.material_family as Material, referenceImage: r.reference_image ?? null,
    measurement: (r.measurement as Measurement | null) ?? null, measuredHex: r.measured_hex, hex: r.hex_value,
    calibration: { dL: 0, chroma: 1, hue: 0, ...((r.calibration as Partial<Calibration>) ?? {}) },
    bags: r.product_slugs ?? [], status: r.status as CandidateStatus, reviewNote: r.review_note, approvedBy: r.approved_by,
    approvedAt: r.approved_at, supplierConfirmed: r.supplier_confirmed, supplierNote: r.supplier_note,
    publishedColourId: r.published_colour_id, publishedAt: r.published_at, updatedAt: r.updated_at,
  };
}

const LIST_COLS = "id, name, material_family, measurement, measured_hex, hex_value, calibration, product_slugs, status, review_note, approved_by, approved_at, supplier_confirmed, supplier_note, published_colour_id, published_at, updated_at";

export async function listCandidates(): Promise<Candidate[]> {
  const { data, error } = await createAdminClient().from("colour_candidates").select(LIST_COLS).order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Row[]).map(toCandidate);
}

export async function getCandidate(id: string): Promise<Candidate | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await createAdminClient().from("colour_candidates").select(`${LIST_COLS}, reference_image`).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toCandidate(data as Row) : null;
}

/** The four bags with their material and their photograph's lightness limit. */
export async function listBags(): Promise<BagInfo[]> {
  const { data, error } = await createAdminClient().from("products").select("id, slug, name").eq("active", true);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((p) => {
      const locked = (PREVIEW_SOURCES[p.slug] ?? []).find((s) => s.locked);
      return { id: p.id, slug: p.slug, name: p.name, material: (familyOf(p.slug) as Material | undefined) ?? null, maxLightness: locked?.maxLightness ?? null };
    })
    .sort((a, b) => BAG_ORDER.indexOf(a.slug) - BAG_ORDER.indexOf(b.slug));
}

/** Every colour assigned to every bag, on or off: what the shop sells. */
export async function listCatalogue(): Promise<CatalogueEntry[]> {
  const { data, error } = await createAdminClient()
    .from("product_colours")
    .select("product_id, colour_id, active, sort_order, colours(name, hex_value, is_two_tone)")
    .order("sort_order");
  if (error) throw new Error(error.message);
  type R = { product_id: string; colour_id: string; active: boolean; colours: { name: string; hex_value: string | null; is_two_tone: boolean } | null };
  return ((data ?? []) as unknown as R[]).map((r) => ({
    productId: r.product_id, colourId: r.colour_id, colourName: r.colours?.name ?? "?", hex: r.colours?.hex_value ?? null,
    active: r.active, isTwoTone: r.colours?.is_two_tone ?? false,
  }));
}

/** Why `hex` cannot go on `bag`, or null. */
export function bagRefusal(bag: BagInfo, material: Material, hex: string | null): string | null {
  if (bag.material !== material) return `${bag.name} is ${bag.material ? MATERIALS[bag.material].toLowerCase() : "another material"}, not ${MATERIALS[material].toLowerCase()}`;
  if (hex && bag.maxLightness !== null && srgbToLab(...hexToRgb(hex))[0] > bag.maxLightness) {
    return `too light for the ${bag.name} photograph (lightest it can show faithfully: L* ${bag.maxLightness})`;
  }
  return null;
}

type Update = Database["public"]["Tables"]["colour_candidates"]["Update"];

async function patch(id: string, values: Update) {
  const { error } = await createAdminClient().from("colour_candidates").update(values).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Any change to what the colour IS withdraws an approval. */
const WITHDRAW = { status: "draft", approved_by: null, approved_at: null } as const;

export async function createCandidate(name: string, material: Material): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 40) throw new Error("Give the colour a name of up to 40 characters.");
  if (clean.includes("&")) throw new Error("One yarn per colour: two-tone colours cannot be shown on a one-yarn photograph.");
  if (!(material in MATERIALS)) throw new Error("Choose the yarn's material.");
  const { data, error } = await createAdminClient().from("colour_candidates").insert({ name: clean, material_family: material }).select("id").single();
  if (error) throw new Error(error.code === "23505" ? `There is already a ${MATERIALS[material].toLowerCase()} colour called ${clean}.` : error.message);
  return data.id;
}

export async function saveReference(id: string, image: string, measurement: Measurement, measuredHex: string) {
  if (!/^data:image\/(webp|jpeg);base64,/.test(image)) throw new Error("The photograph is not a WebP or JPEG image.");
  if (image.length > 690000) throw new Error("The photograph could not be stored (too large).");
  if (!HEX.test(measuredHex)) throw new Error("The measured colour is not valid.");
  await patch(id, {
    reference_image: image, measurement: measurement as unknown as Json, measured_hex: measuredHex, hex_value: measuredHex,
    calibration: { dL: 0, chroma: 1, hue: 0 }, ...WITHDRAW,
  });
}

export async function saveCalibration(id: string, calibration: Calibration, hex: string) {
  if (!HEX.test(hex)) throw new Error("The calibrated colour is not valid.");
  const c = { dL: clamp(calibration.dL, -20, 20), chroma: clamp(calibration.chroma, 0.5, 1.5), hue: clamp(calibration.hue, -20, 20) };
  await patch(id, { calibration: c as unknown as Json, hex_value: hex, ...WITHDRAW });
}

export async function saveBags(id: string, slugs: string[]) {
  const cand = await getCandidate(id);
  if (!cand) throw new Error("Colour not found.");
  const bags = await listBags();
  for (const s of slugs) {
    const bag = bags.find((b) => b.slug === s);
    if (!bag) throw new Error(`Unknown bag ${s}.`);
    const why = bagRefusal(bag, cand.material, cand.hex);
    if (why) throw new Error(`${cand.name} cannot go on the ${bag.name}: ${why}.`);
  }
  await patch(id, { product_slugs: [...new Set(slugs)], ...(cand.status === "approved" ? WITHDRAW : {}) });
}

export async function submitForReview(id: string) {
  const cand = await getCandidate(id);
  if (!cand) throw new Error("Colour not found.");
  if (!cand.referenceImage || !cand.hex) throw new Error("Upload and measure the yarn photograph first.");
  if (cand.status !== "draft" && cand.status !== "rejected") throw new Error("Only a draft can be submitted for review.");
  await patch(id, { status: "in_review", review_note: null });
}

export async function approve(id: string, approvedBy: string, note: string | null) {
  const who = approvedBy.trim();
  if (!who || who.length > 60) throw new Error("Type the name of the person approving.");
  const cand = await getCandidate(id);
  if (!cand) throw new Error("Colour not found.");
  if (cand.status !== "in_review") throw new Error("Only a colour in review can be approved.");
  await patch(id, { status: "approved", approved_by: who, approved_at: new Date().toISOString(), review_note: note?.trim().slice(0, 500) || null });
}

export async function reject(id: string, note: string) {
  const cand = await getCandidate(id);
  if (!cand) throw new Error("Colour not found.");
  if (cand.status !== "in_review" && cand.status !== "approved") throw new Error("Only a colour in review or approved can be rejected.");
  await patch(id, { status: "rejected", approved_by: null, approved_at: null, review_note: note.trim().slice(0, 500) || "Rejected." });
}

export async function setSupplier(id: string, confirmed: boolean, note: string | null) {
  await patch(id, { supplier_confirmed: confirmed, supplier_note: note?.trim().slice(0, 300) || null });
}

/** Publish: the ONLY path from this workflow to an orderable colour. */
export async function publish(id: string): Promise<string> {
  const cand = await getCandidate(id);
  if (!cand) throw new Error("Colour not found.");
  if (cand.status !== "approved") throw new Error("Only an approved colour can be published.");
  if (!cand.supplierConfirmed) throw new Error("Confirm the yarn is available from the supplier first.");
  if (!cand.bags.length) throw new Error("Choose at least one bag.");
  const [bags, catalogue] = await Promise.all([listBags(), listCatalogue()]);
  const ids: string[] = [];
  for (const slug of cand.bags) {
    const bag = bags.find((b) => b.slug === slug);
    if (!bag) throw new Error(`Unknown bag ${slug}.`);
    const why = bagRefusal(bag, cand.material, cand.hex);
    if (why) throw new Error(`${cand.name} cannot go on the ${bag.name}: ${why}.`);
    const clash = catalogue.find((e) => e.productId === bag.id && e.colourName.toLowerCase() === cand.name.toLowerCase() && e.colourId !== cand.publishedColourId);
    if (clash) throw new Error(`The ${bag.name} already has a colour called ${clash.colourName}.`);
    ids.push(bag.id);
  }
  const { data, error } = await createAdminClient().rpc("publish_colour_candidate", { p_candidate: id, p_product_ids: ids });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Turn a catalogue colour on or off for one bag (the shop and checkout obey it). */
export async function setAvailability(productId: string, colourId: string, active: boolean) {
  const { error } = await createAdminClient().rpc("set_product_colour_active", { p_product: productId, p_colour: colourId, p_active: active });
  if (error) throw new Error(error.message);
}

export async function removeCandidate(id: string) {
  const cand = await getCandidate(id);
  if (!cand) return;
  if (cand.publishedColourId) throw new Error("A published colour cannot be deleted. Turn it off on each bag instead.");
  const { error } = await createAdminClient().from("colour_candidates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

function clamp(v: number, lo: number, hi: number) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;
}
