#!/usr/bin/env -S npx tsx

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";
import { concatenateMp3Blobs } from "../lib/audio-metadata";
import { getOpenAIClient } from "../lib/openai-client";
import {
  TRENDING_EVALUATION_FIXTURE_DATES,
  TRENDING_EVALUATION_PROFILES,
  type TrendingEvaluationProfileId,
  type TrendingEvaluationRun,
} from "../lib/trending-brief-evaluation";
import { getTrendingTtsProfile } from "../lib/trending-audio-profile";
import { getTrendingAudioScript } from "../lib/trending-brief";
import { splitTtsTextIntoChunks } from "../lib/tts-client";
import { loadLocalEnvFile } from "./ai-cost-report.mjs";

export const TRENDING_AUDIO_RENDER_HELP_TEXT = `Render nonpublishing Trending evaluation audio with Mini/Marin

Usage:
  npm run render:trending-podcast-eval -- --input <raw-eval.json> --profile <profile-id>

Options:
  --input <path>    Raw Trending evaluation JSON.
  --profile <id>    One approved evaluation profile ID.
  --output <dir>    Optional output directory. Defaults beside the report.
  --help, -h        Show this help.

This command calls OpenAI speech directly and writes local MP3s. It has no
podcast sync, Convex, storage-upload, or publication capability.
`;

export type TrendingAudioRenderOptions = Readonly<{
  help: boolean;
  inputPath: string | null;
  outputDirectory: string | null;
  profileId: TrendingEvaluationProfileId | null;
}>;

const readFlagValue = (
  argv: readonly string[],
  index: number,
): Readonly<{ consumed: number; value: string }> => {
  const argument = argv[index] ?? "";
  const equalsIndex = argument.indexOf("=");
  if (equalsIndex >= 0) {
    const value = argument.slice(equalsIndex + 1).trim();
    if (!value)
      throw new Error(`${argument.slice(0, equalsIndex)} requires a value.`);
    return { consumed: 0, value };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${argument} requires a value.`);
  }
  return { consumed: 1, value };
};

export const parseTrendingAudioRenderArgs = (
  argv: readonly string[],
  cwd = process.cwd(),
): TrendingAudioRenderOptions => {
  let help = false;
  let inputPath: string | null = null;
  let outputDirectory: string | null = null;
  let profileId: TrendingEvaluationProfileId | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--input" || argument.startsWith("--input=")) {
      const parsed = readFlagValue(argv, index);
      inputPath = path.resolve(cwd, parsed.value);
      index += parsed.consumed;
      continue;
    }
    if (argument === "--profile" || argument.startsWith("--profile=")) {
      const parsed = readFlagValue(argv, index);
      const profile = TRENDING_EVALUATION_PROFILES.find(
        ({ id }) => id === parsed.value,
      );
      if (!profile)
        throw new Error(`Unknown Trending evaluation profile: ${parsed.value}`);
      profileId = profile.id;
      index += parsed.consumed;
      continue;
    }
    if (argument === "--output" || argument.startsWith("--output=")) {
      const parsed = readFlagValue(argv, index);
      outputDirectory = path.resolve(cwd, parsed.value);
      index += parsed.consumed;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!help && !inputPath) throw new Error("--input is required.");
  if (!help && !profileId) throw new Error("--profile is required.");

  return { help, inputPath, outputDirectory, profileId };
};

type TrendingSpeechClient = Pick<OpenAI, "audio">;

export type TrendingAudioSynthesize = (
  request: Readonly<{
    input: string;
    instructions: string;
    model: string;
    voice: string;
  }>,
) => Promise<Blob>;

export type TrendingAudioRenderManifest = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  inputPath: string;
  profileId: TrendingEvaluationProfileId;
  tts: Readonly<{
    provider: "openai";
    model: string;
    voice: string;
    promptVersion: string;
  }>;
  files: readonly Readonly<{
    fixtureDate: string;
    sourceFeedDate: string;
    trendingDate: string;
    path: string;
    byteLength: number;
    chunkCount: number;
    scriptCharacters: number;
    scriptWords: number;
    includesAudibleAiDisclosure: true;
  }>[];
}>;

const countWords = (text: string): number =>
  text.trim().split(/\s+/u).filter(Boolean).length;

const defaultOutputDirectory = (
  inputPath: string,
  profileId: TrendingEvaluationProfileId,
): string => {
  const reportName = path.basename(inputPath, path.extname(inputPath));
  return path.join(
    path.dirname(inputPath),
    "audio",
    `${reportName}-${profileId}`,
  );
};

export const createOpenAiTrendingAudioSynthesizer =
  (client: TrendingSpeechClient): TrendingAudioSynthesize =>
  async ({ input, instructions, model, voice }) => {
    const response = await client.audio.speech.create({
      input,
      instructions,
      model,
      response_format: "mp3",
      voice,
    });
    return new Blob([await response.arrayBuffer()], { type: "audio/mpeg" });
  };

export const renderTrendingEvaluationAudio = async ({
  inputPath,
  profileId,
  outputDirectory = defaultOutputDirectory(inputPath, profileId),
  run,
  synthesize,
  generatedAt = new Date().toISOString(),
}: {
  inputPath: string;
  outputDirectory?: string;
  profileId: TrendingEvaluationProfileId;
  run: TrendingEvaluationRun;
  synthesize: TrendingAudioSynthesize;
  generatedAt?: string;
}): Promise<
  Readonly<{ manifest: TrendingAudioRenderManifest; manifestPath: string }>
> => {
  const candidates = run.candidates.filter(
    (candidate) => candidate.profileId === profileId,
  );
  if (candidates.length !== TRENDING_EVALUATION_FIXTURE_DATES.length) {
    throw new Error(
      `Expected ${TRENDING_EVALUATION_FIXTURE_DATES.length} fixtures for ${profileId}; found ${candidates.length}.`,
    );
  }

  const profile = getTrendingTtsProfile();
  await mkdir(outputDirectory, { recursive: true });
  const files: TrendingAudioRenderManifest["files"][number][] = [];

  for (const fixtureDate of TRENDING_EVALUATION_FIXTURE_DATES) {
    const candidate = candidates.find(
      (item) => item.fixtureDate === fixtureDate,
    );
    if (!candidate)
      throw new Error(`Missing ${profileId} fixture ${fixtureDate}.`);

    const script = getTrendingAudioScript(candidate.transcript);
    const chunks = splitTtsTextIntoChunks(script);
    if (chunks.length === 0)
      throw new Error(`Empty audio script for ${fixtureDate}.`);
    const audioChunks: Blob[] = [];
    for (const input of chunks) {
      audioChunks.push(
        await synthesize({
          input,
          instructions: profile.instructions ?? "",
          model: profile.model,
          voice: profile.voiceId,
        }),
      );
    }
    const audio = await concatenateMp3Blobs(audioChunks, {
      stripId3Tags: "leading",
    });
    const outputPath = path.join(outputDirectory, `${fixtureDate}.mp3`);
    await writeFile(outputPath, Buffer.from(await audio.arrayBuffer()), {
      flag: "wx",
    });
    files.push({
      fixtureDate,
      sourceFeedDate: candidate.sourceFeedDate,
      trendingDate: candidate.trendingDate,
      path: outputPath,
      byteLength: audio.size,
      chunkCount: chunks.length,
      scriptCharacters: script.length,
      scriptWords: countWords(script),
      includesAudibleAiDisclosure: true,
    });
  }

  const manifest: TrendingAudioRenderManifest = {
    schemaVersion: 1,
    generatedAt,
    inputPath,
    profileId,
    tts: {
      provider: "openai",
      model: profile.model,
      voice: profile.voiceId,
      promptVersion: profile.promptVersion,
    },
    files,
  };
  const manifestPath = path.join(outputDirectory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { manifest, manifestPath };
};

type MainDependencies = Readonly<{
  getClient?: () => TrendingSpeechClient;
  loadEnv?: (cwd: string) => Promise<unknown>;
  writeStdout?: (text: string) => unknown;
}>;

export const main = async (
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  {
    getClient = getOpenAIClient,
    loadEnv = loadLocalEnvFile,
    writeStdout = (text) => process.stdout.write(text),
  }: MainDependencies = {},
): Promise<void> => {
  const options = parseTrendingAudioRenderArgs(argv, cwd);
  if (options.help) {
    writeStdout(TRENDING_AUDIO_RENDER_HELP_TEXT);
    return;
  }
  if (!options.inputPath || !options.profileId) {
    throw new Error("Audio render arguments were not resolved.");
  }

  await loadEnv(cwd);
  process.env.AI_COST_LEDGER_MODE = "off";
  const run = JSON.parse(
    await readFile(options.inputPath, "utf8"),
  ) as TrendingEvaluationRun;
  const result = await renderTrendingEvaluationAudio({
    inputPath: options.inputPath,
    ...(options.outputDirectory
      ? { outputDirectory: options.outputDirectory }
      : {}),
    profileId: options.profileId,
    run,
    synthesize: createOpenAiTrendingAudioSynthesizer(getClient()),
  });
  writeStdout(
    `Rendered ${result.manifest.files.length} nonpublishing Mini/Marin MP3s.\nManifest: ${result.manifestPath}\n`,
  );
};

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error: unknown) => {
    console.error(
      `[render-trending-brief-eval-audio] ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
