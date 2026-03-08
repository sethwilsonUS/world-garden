import { normalizeTtsText } from "@/lib/tts-normalize";
import {
  TTS_API_ROUTE,
  TTS_MIN_TEXT_LENGTH,
  getClientTtsMaxWordsPerRequest,
  type TtsRequest,
} from "@/lib/tts-contract";

type TtsErrorBody = {
  error?: string;
};

type TtsClientOptions = {
  apiBaseUrl?: string;
};

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const resolveTtsApiRoute = (apiBaseUrl?: string): string =>
  apiBaseUrl ? new URL(TTS_API_ROUTE, apiBaseUrl).toString() : TTS_API_ROUTE;

const splitIntoParagraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

const splitIntoSentences = (text: string): string[] => {
  const matches = text.match(/[^.!?]+(?:[.!?]+|$)/g);
  if (!matches) return [text.trim()].filter(Boolean);
  return matches.map((part) => part.trim()).filter(Boolean);
};

const splitIntoWordChunks = (
  text: string,
  maxWords = getClientTtsMaxWordsPerRequest(),
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }

  return chunks;
};

const packSegments = (
  segments: string[],
  maxWords = getClientTtsMaxWordsPerRequest(),
): string[] => {
  const chunks: string[] = [];
  let current = "";
  let currentWords = 0;

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const words = countWords(trimmed);
    if (words > maxWords) {
      throw new Error("Segment exceeded TTS chunk limit during packing");
    }

    if (currentWords > 0 && currentWords + words > maxWords) {
      chunks.push(current);
      current = trimmed;
      currentWords = words;
      continue;
    }

    current = current ? `${current} ${trimmed}` : trimmed;
    currentWords += words;
  }

  if (current) chunks.push(current);

  return chunks;
};

const splitLongParagraph = (
  paragraph: string,
  maxWords = getClientTtsMaxWordsPerRequest(),
): string[] => {
  if (countWords(paragraph) <= maxWords) return [paragraph];

  const sentences = splitIntoSentences(paragraph);
  if (sentences.length > 1) {
    return packSegments(
      sentences.flatMap((sentence) =>
        countWords(sentence) <= maxWords
          ? [sentence]
          : splitIntoWordChunks(sentence, maxWords),
      ),
      maxWords,
    );
  }

  return splitIntoWordChunks(paragraph, maxWords);
};

export const splitTtsTextIntoChunks = (
  text: string,
  maxWords = getClientTtsMaxWordsPerRequest(),
): string[] => {
  const normalized = normalizeTtsText(text).trim();
  if (!normalized) return [];

  const paragraphs = splitIntoParagraphs(normalized);
  if (paragraphs.length > 1) {
    return packSegments(
      paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, maxWords)),
      maxWords,
    );
  }

  return splitLongParagraph(normalized, maxWords);
};

const fetchSingleTtsAudio = async ({
  text,
  voiceId,
}: TtsRequest, options?: TtsClientOptions): Promise<Blob> => {
  const resp = await fetch(resolveTtsApiRoute(options?.apiBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      ...(voiceId ? { voiceId } : {}),
    }),
  });

  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as TtsErrorBody;
    throw new Error(body.error ?? "Audio generation failed");
  }

  return await resp.blob();
};

export const generateTtsAudio = async ({
  text,
  voiceId,
}: TtsRequest, options?: TtsClientOptions): Promise<Blob> => {
  const chunks = splitTtsTextIntoChunks(text);
  const joinedText = chunks.join(" ");

  if (!joinedText || joinedText.length < TTS_MIN_TEXT_LENGTH) {
    throw new Error("Text is too short to generate audio");
  }

  const audioChunks: Blob[] = [];
  for (const chunk of chunks) {
    audioChunks.push(
      await fetchSingleTtsAudio({ text: chunk, voiceId }, options),
    );
  }

  if (audioChunks.length === 1) {
    return audioChunks[0];
  }

  return new Blob(audioChunks, { type: "audio/mpeg" });
};

export const generateTtsAudioUrl = async (
  request: TtsRequest,
  options?: TtsClientOptions,
): Promise<string> => URL.createObjectURL(await generateTtsAudio(request, options));
