import {
  anyApi,
  cronJobs,
} from "convex/server";
import { internal } from "./_generated/api";
import type { FunctionReferenceFromExport } from "./lib/functionReferenceFromExport";

const crons = cronJobs();
const maintainAiCostLedgerInternal: FunctionReferenceFromExport<
  typeof import("./aiCostLedger").maintainAiCostLedgerInternal
> = anyApi.aiCostLedger.maintainAiCostLedgerInternal;

crons.hourly(
  "scrub expired product feedback contacts",
  { minuteUTC: 23 },
  internal.productFeedback.scrubExpiredProductFeedbackContacts,
);

crons.hourly(
  "clear inactive meaningful-use listening sessions",
  { minuteUTC: 29 },
  internal.badges.cleanupExpiredMeaningfulUseSessions,
  {},
);

crons.hourly(
  "delete expired route quota records",
  { minuteUTC: 41 },
  internal.rateLimits.cleanupExpiredRouteQuotas,
);

crons.hourly(
  "maintain AI cost ledger retention and cohorts",
  { minuteUTC: 47 },
  maintainAiCostLedgerInternal,
);

crons.hourly(
  "reconcile account-owned audio storage",
  { minuteUTC: 53 },
  internal.accountOwnedStorage.sweepAccountOwnedStorageOrphans,
  { continuation: false },
);

export default crons;
