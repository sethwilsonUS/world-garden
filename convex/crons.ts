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

export default crons;
