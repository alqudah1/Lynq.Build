import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { resolveMarketingAuthContext, requireMarketingManageContentAuthority } from "@/lib/marketing-os/authz";
import { loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";
import { TTS_VOICES, VOICE_STYLES, synthesizeSpeech, type VoiceStyle } from "@/lib/social-os/providers/ai/openai-speech";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const bodySchema = z
  .object({
    text: z.string().trim().min(1).max(600),
    voice: z.enum(TTS_VOICES),
    style: z.enum(Object.keys(VOICE_STYLES) as [VoiceStyle, ...VoiceStyle[]]),
    speed: z.number().min(0.75).max(1.5).optional(),
  })
  .strict();

/**
 * POST /api/organizations/{organizationId}/social/voiceover: speaks one line of a reel script and
 * returns the MP3 (nothing is stored). Needs content-management rights; the voice is AI, so posts
 * that use it must carry the platform's AI-generated label.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const ctx = await resolveMarketingAuthContext(db, { organizationId, actorUserId: user.userId });
    await requireMarketingManageContentAuthority(db, ctx, "social_voiceover", "new");
    const body = await parseJsonBody(request, bodySchema);
    const { bytes, model } = await synthesizeSpeech(await loadSocialAiEnv(), body);
    return new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "x-voice-model": model, "x-ai-generated": "true" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
