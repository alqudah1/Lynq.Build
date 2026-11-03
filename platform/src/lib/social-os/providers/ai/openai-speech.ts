import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { defaultFetch, present, requestJson, type ProviderDeps, type SocialAiEnv } from "./http";

/**
 * Text to speech for reel voiceovers (OpenAI Audio API). Used for the Arabic cuts: the voice is
 * synthetic, so every post that uses it must carry the platform's AI-generated label.
 */

export const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const LABEL = "OpenAI speech";

/** Preferred speech models, best first. Only steerable models (the `mini-tts` family) take accent instructions. */
export const TTS_MODEL_PREFERENCE = ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"] as const;
export const TTS_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

/** How the voice should sound. Steerable models get these as instructions; others ignore them. */
export const VOICE_STYLES = {
  "ar-levant": { label: "Arabic, Levantine (Amman)", instructions: "Speak natural Levantine Arabic the way people in Amman, Jordan talk. Warm, clear, a little upbeat, like a short social video. Read the text exactly as written." },
  "ar-msa": { label: "Arabic, Modern Standard", instructions: "Speak clear Modern Standard Arabic with a warm, friendly tone, like a short social video. Read the text exactly as written." },
  en: { label: "English", instructions: "Speak natural, warm, conversational English, like a short social video. Read the text exactly as written." },
} as const;
export type VoiceStyle = keyof typeof VOICE_STYLES;

/** The newest steerable speech model the account has, else the best older one, else the default. */
export function pickTtsModel(available: Iterable<string>): string {
  const ids = [...available];
  const steerable = ids.filter((id) => /mini-tts/.test(id)).sort().reverse();
  if (steerable.length) return steerable.find((id) => !/\d{4}-\d{2}-\d{2}$/.test(id)) ?? steerable[0];
  return TTS_MODEL_PREFERENCE.find((m) => ids.includes(m)) ?? ids.find((id) => /tts/.test(id)) ?? TTS_MODEL_PREFERENCE[0];
}

export function supportsInstructions(model: string): boolean {
  return /mini-tts/.test(model);
}

/** Builds the Audio API request body. Exported for tests. */
export function speechRequestBody(input: { model: string; text: string; voice: TtsVoice; style: VoiceStyle; speed?: number }): Record<string, unknown> {
  return {
    model: input.model,
    input: input.text,
    voice: input.voice,
    response_format: "mp3",
    ...(input.speed && input.speed !== 1 ? { speed: Math.min(1.5, Math.max(0.75, input.speed)) } : {}),
    ...(supportsInstructions(input.model) ? { instructions: VOICE_STYLES[input.style].instructions } : {}),
  };
}

let modelCache: { at: number; model: string } | null = null;

async function resolveModel(env: SocialAiEnv, fetchImpl: ReturnType<typeof defaultFetch>): Promise<string> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60 * 1000) return modelCache.model;
  try {
    const raw = (await requestJson(fetchImpl, LABEL, OPENAI_MODELS_URL, { method: "GET", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` } })) as { data?: { id?: string }[] };
    const model = pickTtsModel((raw.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string"));
    modelCache = { at: Date.now(), model };
    return model;
  } catch {
    return TTS_MODEL_PREFERENCE[0];
  }
}

/** Speaks `text` and returns MP3 bytes. Throws when no OpenAI key is configured or the call fails. */
export async function synthesizeSpeech(env: SocialAiEnv, input: { text: string; voice: TtsVoice; style: VoiceStyle; speed?: number }, deps?: ProviderDeps): Promise<{ bytes: Uint8Array; model: string }> {
  if (!present(env.OPENAI_API_KEY)) throw new SocialProviderNotConfiguredError(LABEL, ["OPENAI_API_KEY"]);
  const fetchImpl = defaultFetch(deps);
  const model = await resolveModel(env, fetchImpl);
  let res: Response;
  try {
    res = await fetchImpl(OPENAI_SPEECH_URL, { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY.trim()}`, "content-type": "application/json" }, body: JSON.stringify(speechRequestBody({ model, ...input })) });
  } catch {
    throw new SocialGenerationFailedError(LABEL, "network error reaching the provider", true);
  }
  if (!res.ok) {
    const status = res.status;
    await res.text().catch(() => "");
    throw new SocialGenerationFailedError(LABEL, status === 401 || status === 403 ? "authentication failed — check the API key" : `request failed (${status})`, status === 429 || status >= 500);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new SocialGenerationFailedError(LABEL, "the provider returned no audio", true);
  return { bytes, model };
}
