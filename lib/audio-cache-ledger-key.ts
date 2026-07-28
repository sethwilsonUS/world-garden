import {
  getAiCostLedgerMode,
  type AiCostLedgerMode,
} from "./ai-cost-ledger-contract";

export const createAudioCacheLedgerAssetKey = ({
  mode = getAiCostLedgerMode(),
  createId = () => crypto.randomUUID(),
}: {
  mode?: AiCostLedgerMode;
  createId?: () => string;
} = {}): string | undefined => {
  if (mode !== "observe") return undefined;
  try {
    return createId();
  } catch {
    console.warn("[ai-cost-ledger] Audio cache identity was not created.");
    return undefined;
  }
};
