#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  EXPO_AUDIO_VERSION,
  patchInstalledExpoAudio,
} = require("./expo-audio-background-safety.js");

const [modeArgument, ...unexpectedArguments] = process.argv.slice(2);
if (
  unexpectedArguments.length > 0 ||
  (modeArgument !== "--apply" && modeArgument !== "--check")
) {
  throw new Error(
    "Usage: node scripts/apply-expo-audio-background-safety.mjs --check|--apply",
  );
}

const mode = modeArgument === "--apply" ? "apply" : "check";
const result = patchInstalledExpoAudio(process.cwd(), mode);
const action =
  mode === "check"
    ? "verified"
    : result.changed
      ? "applied"
      : "already applied";

process.stdout.write(
  `Expo Audio ${EXPO_AUDIO_VERSION} safety/playlist backport ${action}.\n`,
);
