const ELEVEN_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

/** Bump this whenever normalizeTtsText rules change to invalidate cached audio. */
export const TTS_NORM_VERSION = "ttsNorm:1";

type TtsOptions = {
  text: string;
  voiceId: string;
  modelId?: string;
};

/**
 * Expand abbreviations that TTS engines commonly mispronounce.
 * Context-dependent abbreviations (St., Dr.) use position heuristics:
 *   - Before a capitalized word → proper-noun reading (Saint, Doctor)
 *   - After another word / end of phrase → address reading (Street, Drive)
 */
export const normalizeTtsText = (text: string): string => {
  let r = text;

  // ── Context-dependent ──────────────────────────────────────────────
  // "St." before a capitalized word → Saint  (St. Louis, St. Patrick)
  r = r.replace(/\bSt\.\s+(?=[A-Z])/g, "Saint ");
  // remaining "St." after a word → Street  (Main St., Baker St.)
  r = r.replace(/(\w)\s+St\.(?=[\s,;.!?]|$)/gm, "$1 Street");

  // "Dr." before a capitalized word → Doctor  (Dr. King)
  r = r.replace(/\bDr\.\s+(?=[A-Z])/g, "Doctor ");
  // remaining "Dr." after a word → Drive  (Sunset Dr.)
  r = r.replace(/(\w)\s+Dr\.(?=[\s,;.!?]|$)/gm, "$1 Drive");

  // "Mt." → Mount  (Mt. Everest, Mt. Rushmore)
  r = r.replace(/\bMt\.\s*/g, "Mount ");

  // "Ft." before a capitalized word → Fort  (Ft. Lauderdale)
  r = r.replace(/\bFt\.\s+(?=[A-Z])/g, "Fort ");

  // ── Unambiguous abbreviations ──────────────────────────────────────
  const SIMPLE: [RegExp, string][] = [
    [/\bAve\.(?=[\s,;]|$)/gm, "Avenue"],
    [/\bBlvd\.(?=[\s,;]|$)/gm, "Boulevard"],
    [/\bDept\.(?=[\s,;]|$)/gm, "Department"],
    [/\bJr\.(?=[\s,;]|$)/gm, "Junior"],
    [/\bSr\.(?=[\s,;]|$)/gm, "Senior"],
    [/\bCorp\.(?=[\s,;]|$)/gm, "Corporation"],
    [/\bInc\.(?=[\s,;]|$)/gm, "Incorporated"],
    [/\bLtd\.(?=[\s,;]|$)/gm, "Limited"],
    [/\bvs\.(?=[\s,;]|$)/gm, "versus"],
    [/\bVol\.(?=[\s,;]|$)/gm, "Volume"],
    [/\bca\.\s+(?=\d)/g, "circa "],
    [/\bNo\.\s*(?=\d)/g, "Number "],
    [/\bPt\.\s*(?=\d)/g, "Part "],

    // Titles before a proper name
    [/\bGen\.\s+(?=[A-Z])/g, "General "],
    [/\bGov\.\s+(?=[A-Z])/g, "Governor "],
    [/\bSgt\.\s+(?=[A-Z])/g, "Sergeant "],
    [/\bCapt\.\s+(?=[A-Z])/g, "Captain "],
    [/\bCol\.\s+(?=[A-Z])/g, "Colonel "],
    [/\bLt\.\s+(?=[A-Z])/g, "Lieutenant "],
    [/\bProf\.\s+(?=[A-Z])/g, "Professor "],
    [/\bSen\.\s+(?=[A-Z])/g, "Senator "],
    [/\bRep\.\s+(?=[A-Z])/g, "Representative "],
  ];

  for (const [pattern, replacement] of SIMPLE) {
    r = r.replace(pattern, replacement);
  }

  return r;
};

export const generateTtsAudio = async ({
  text,
  voiceId,
  modelId = "eleven_turbo_v2_5",
}: TtsOptions): Promise<Blob> => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured");
  }

  const normalizedText = normalizeTtsText(text);

  const response = await fetch(`${ELEVEN_TTS_URL}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: normalizedText,
      model_id: modelId,
      output_format: "mp3_44100_128",
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "ElevenLabs rejected the request. This usually means the API key " +
          "is invalid, or the free tier has been restricted for this account. " +
          "A paid ElevenLabs plan resolves this.",
      );
    }
    if (response.status === 402) {
      throw new Error(
        "This voice requires a paid ElevenLabs plan. Try using a default " +
          "pre-made voice (e.g. Rachel: 21m00Tcm4TlvDq8ikWAM) or upgrade " +
          "your ElevenLabs subscription.",
      );
    }
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`);
  }

  return await response.blob();
};
