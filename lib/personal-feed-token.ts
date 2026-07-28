const PERSONAL_FEED_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export const createPersonalFeedToken = (): string =>
  `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;

export const isValidPersonalFeedToken = (value: string): boolean =>
  PERSONAL_FEED_TOKEN_PATTERN.test(value);
