import { anyApi } from "convex/server";
import { fetchAction } from "convex/nextjs";
import { after } from "next/server";
import {
  createAiCostProviderAttemptAttestation,
  getAiCostLedgerMode,
  type AiCostLedgerMode,
  type AiCostProviderAttempt,
} from "./ai-cost-ledger-contract";
import type { ServerAttestation } from "./server-attestation";

type AiCostAttemptSinkArgs = {
  attempt: AiCostProviderAttempt;
  attestation: ServerAttestation;
};

type AiCostAttemptSink = (args: AiCostAttemptSinkArgs) => Promise<unknown>;

export const createFailOpenAiCostAttemptRecorder =
  ({
    getMode = getAiCostLedgerMode,
    createAttestation = createAiCostProviderAttemptAttestation,
    sink,
    warn = console.warn,
  }: {
    getMode?: () => AiCostLedgerMode;
    createAttestation?: (
      attempt: AiCostProviderAttempt,
    ) => Promise<ServerAttestation>;
    sink: AiCostAttemptSink;
    warn?: (message: string) => void;
  }): ((attempt: AiCostProviderAttempt) => Promise<void>) =>
  async (attempt) => {
    if (getMode() !== "observe") return;

    try {
      const attestation = await createAttestation(attempt);
      await sink({ attempt, attestation });
    } catch {
      warn("[ai-cost-ledger] Provider attempt recording failed.");
    }
  };

const writeProviderAttempt: AiCostAttemptSink = async (args) =>
  await fetchAction(anyApi.aiCostLedger.recordProviderAttempt, args);

const writeProviderAttemptFailOpen = createFailOpenAiCostAttemptRecorder({
  sink: writeProviderAttempt,
});

export const recordProviderAttemptFailOpen = (
  attempt: AiCostProviderAttempt,
): Promise<void> => {
  const task = writeProviderAttemptFailOpen(attempt);
  try {
    after(async () => await task);
  } catch {
    // The write is already in flight; a missing request context is harmless.
  }
  return task;
};
