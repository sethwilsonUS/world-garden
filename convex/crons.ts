import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "scrub expired product feedback contacts",
  { minuteUTC: 23 },
  internal.productFeedback.scrubExpiredProductFeedbackContacts,
);

crons.hourly(
  "delete expired route quota records",
  { minuteUTC: 41 },
  internal.rateLimits.cleanupExpiredRouteQuotas,
);

crons.hourly(
  "reconcile account-owned audio storage",
  { minuteUTC: 53 },
  internal.accountOwnedStorage.sweepAccountOwnedStorageOrphans,
  { continuation: false },
);

export default crons;
