export const isLocalMode = (): boolean =>
  process.env.LOCAL_MODE === "true" ||
  process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
