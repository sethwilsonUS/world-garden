import { NextRequest, NextResponse } from "next/server";
import {
  TTS_MIN_TEXT_LENGTH,
  getServerTtsMaxWordsPerRequest,
  type TtsRequest,
} from "@/lib/tts-contract";
import {
  buildTtsMetadataHeaders,
  getTtsMetadata,
  getTtsProfile,
  isEdgeTtsVoice,
  isOpenAiTtsVoice,
  isTtsFallbackEnabled,
  normalizeTtsProvider,
  type TtsMetadata,
  type TtsProfile,
  type TtsProvider,
} from "@/lib/tts-profile";

const OPENAI_SPEECH_ENDPOINT = "https://api.openai.com/v1/audio/speech";

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Audio generation failed";

const readErrorBody = async (response: Response): Promise<string> => {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text().catch(() => "");

  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(text) as {
        error?: string | { message?: string };
      };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
      if (
        body.error &&
        typeof body.error === "object" &&
        body.error.message?.trim()
      ) {
        return body.error.message;
      }
    } catch {
      // Use the text fallback below.
    }
  }

  return text.replace(/\s+/g, " ").trim() || `HTTP ${response.status}`;
};

const audioResponse = (
  audioBuffer: Buffer,
  metadata: TtsMetadata,
  options?: { fallback?: boolean },
): NextResponse => {
  const headers = {
    "Content-Type": "audio/mpeg",
    "Content-Length": String(audioBuffer.length),
    ...buildTtsMetadataHeaders(metadata, options),
  };

  return new NextResponse(new Uint8Array(audioBuffer), {
    status: 200,
    headers,
  });
};

const generateOpenAiSpeech = async (
  text: string,
  profile: TtsProfile,
): Promise<Buffer> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI TTS");
  }

  const response = await fetch(OPENAI_SPEECH_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: profile.model,
      voice: profile.voiceId,
      input: text,
      instructions: profile.instructions,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorBody(response));
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.length === 0) {
    throw new Error("No audio was generated");
  }

  return audioBuffer;
};

const generateEdgeSpeech = async (
  req: NextRequest,
  text: string,
  profile: TtsProfile,
): Promise<Buffer> => {
  const response = await fetch(new URL("/api/tts/edge", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voiceId: profile.voiceId,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorBody(response));
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.length === 0) {
    throw new Error("No audio was generated");
  }

  return audioBuffer;
};

const resolveRequestedProvider = (body: TtsRequest): TtsProvider =>
  normalizeTtsProvider(body.provider) ?? getTtsProfile().provider;

const getVoiceValidationError = (
  provider: TtsProvider,
  voiceId: string | undefined,
): string | null => {
  if (!voiceId) return null;
  if (provider === "openai" && !isOpenAiTtsVoice(voiceId)) {
    return `Unsupported OpenAI TTS voice: ${voiceId}`;
  }
  if (provider === "edge" && !isEdgeTtsVoice(voiceId)) {
    return `Unsupported Edge TTS voice: ${voiceId}`;
  }
  return null;
};

export const POST = async (req: NextRequest) => {
  let provider: TtsProvider = "openai";

  try {
    const body = (await req.json()) as TtsRequest;
    const { text, voiceId } = body;

    if (!text || text.length < TTS_MIN_TEXT_LENGTH) {
      return NextResponse.json(
        { error: "Text is too short to generate audio" },
        { status: 400 },
      );
    }

    const maxWordsPerRequest = getServerTtsMaxWordsPerRequest();

    if (countWords(text) > maxWordsPerRequest) {
      return NextResponse.json(
        {
          error: `Text exceeds ${maxWordsPerRequest} words; split it into smaller chunks before requesting TTS`,
        },
        { status: 400 },
      );
    }

    provider = resolveRequestedProvider(body);
    const voiceValidationError = getVoiceValidationError(provider, voiceId);
    if (voiceValidationError) {
      return NextResponse.json({ error: voiceValidationError }, { status: 400 });
    }

    const primaryProfile = getTtsProfile(provider, voiceId);

    if (primaryProfile.provider === "edge") {
      const audioBuffer = await generateEdgeSpeech(req, text, primaryProfile);
      return audioResponse(audioBuffer, getTtsMetadata(primaryProfile));
    }

    try {
      const audioBuffer = await generateOpenAiSpeech(text, primaryProfile);
      return audioResponse(audioBuffer, getTtsMetadata(primaryProfile));
    } catch (error) {
      if (!isTtsFallbackEnabled()) {
        throw error;
      }

      const edgeProfile = getTtsProfile("edge", voiceId);
      const audioBuffer = await generateEdgeSpeech(req, text, edgeProfile);
      return audioResponse(audioBuffer, getTtsMetadata(edgeProfile), {
        fallback: true,
      });
    }
  } catch (err) {
    console.error(`${provider === "edge" ? "Edge" : "OpenAI"} TTS generation failed:`, err);
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
};
