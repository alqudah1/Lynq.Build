import "server-only";

import { getToken } from "@vercel/connect";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { handleRouteError, jsonSuccess } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** Authenticated, secret-free connection check used by the Office before software delivery. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const db = createDbClient(loadEnv());
    const user = await getAuthenticatedUser(db);
    await requireOrganizationMembership(db, organizationId, user.userId);

    const token = await getToken("github/lynq-office-github", { subject: { type: "app" } });
    const response = await fetch("https://api.github.com/installation/repositories", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GitHub connection check failed (${response.status})`);
    const payload = (await response.json()) as { repositories?: Array<{ full_name?: string; private?: boolean; permissions?: Record<string, boolean> }> };
    const repositories = (payload.repositories ?? []).map((repo) => ({ fullName: repo.full_name ?? "", private: Boolean(repo.private), permissions: repo.permissions ?? {} }));
    const expectedRepository = repositories.find((repo) => repo.fullName.toLowerCase() === "alqudah1/lynq.build");

    return jsonSuccess({ connected: Boolean(expectedRepository), leastPrivilege: repositories.length === 1, repositories });
  } catch (error) {
    return handleRouteError(error);
  }
}
