export const getPodcastAdminAuthError = (
  authHeader: string | null,
  secret = process.env.CRON_SECRET,
): string | null => {
  if (!secret) {
    return "CRON_SECRET is not configured";
  }

  if (authHeader !== `Bearer ${secret}`) {
    return "Unauthorized";
  }

  return null;
};
