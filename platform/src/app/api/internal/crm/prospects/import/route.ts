import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createDbClient } from "@/db/client";
import { organizationMemberships, organizations, users } from "@/db/schema";
import { importProspects, prospectImportSchema } from "@/lib/crm/prospect-import";
import { loadEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  organizationSlug: z.string().trim().min(1).max(80),
  actorEmail: z.string().trim().email().max(320),
  consentAttestation: z.string().trim().min(1).max(1000),
  prospectImport: prospectImportSchema,
}).strict();

function authorized(request: Request): boolean {
  const expected = process.env.LYNQ_INTERNAL_IMPORT_TOKEN || "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (expected.length < 32 || expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid prospect import", details: parsed.error.flatten() }, { status: 400 });

  const env = loadEnv();
  const db = createDbClient(env, { timeoutMs: 30_000 });
  const [membership] = await db
    .select({ organizationId: organizations.id, actorUserId: users.id })
    .from(organizations)
    .innerJoin(organizationMemberships, eq(organizationMemberships.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(and(eq(organizations.slug, parsed.data.organizationSlug), eq(users.email, parsed.data.actorEmail.toLowerCase())))
    .limit(1);

  if (!membership) return Response.json({ error: "Organization member not found" }, { status: 404 });

  try {
    const result = await importProspects(db, {
      organizationId: membership.organizationId,
      actorUserId: membership.actorUserId,
      prospectImport: parsed.data.prospectImport,
      consentAttestation: parsed.data.consentAttestation,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Internal prospect import failed", error);
    return Response.json({ error: "Prospect import failed" }, { status: 500 });
  }
}
