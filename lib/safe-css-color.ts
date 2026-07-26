const CSS_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;
const FUNCTIONAL_COLOR_PATTERN = /^(rgb|rgba|hsl|hsla|hwb)\((.*)\)$/i;
const HEX_COLOR_PATTERN =
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const isCssNumber = (value: string): boolean => CSS_NUMBER_PATTERN.test(value);

const isCssNumberOrPercentage = (value: string): boolean =>
  value.endsWith("%") ? isCssNumber(value.slice(0, -1)) : isCssNumber(value);

const isCssPercentage = (value: string): boolean =>
  value.endsWith("%") && isCssNumber(value.slice(0, -1));

const isCssAngle = (value: string): boolean => {
  const match = /^(.+?)(deg|grad|rad|turn)?$/i.exec(value);
  return Boolean(match && isCssNumber(match[1] ?? ""));
};

const isValidFunctionalCssColor = (name: string, body: string): boolean => {
  const isRgb = name === "rgb" || name === "rgba";
  const validateChannels = (channels: readonly string[]): boolean => {
    if (channels.length !== 3) return false;
    if (isRgb) return channels.every(isCssNumberOrPercentage);
    return (
      isCssAngle(channels[0] ?? "") &&
      isCssPercentage(channels[1] ?? "") &&
      isCssPercentage(channels[2] ?? "")
    );
  };

  if (body.includes(",")) {
    if (name === "hwb" || body.includes("/")) return false;
    const parts = body.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return false;
    const channels = parts.slice(0, 3);
    if (
      isRgb &&
      !channels.every((channel) => channel.endsWith("%")) &&
      !channels.every((channel) => !channel.endsWith("%"))
    ) {
      return false;
    }
    return (
      validateChannels(channels) &&
      (parts.length === 3 || isCssNumberOrPercentage(parts[3] ?? ""))
    );
  }

  const slashParts = body.split("/");
  if (slashParts.length > 2) return false;
  const channels = (slashParts[0] ?? "").trim().split(/\s+/).filter(Boolean);
  const alpha = slashParts[1]?.trim();
  return (
    validateChannels(channels) &&
    (alpha == null || (!alpha.includes(" ") && isCssNumberOrPercentage(alpha)))
  );
};

/**
 * Accepts only the small, source-derived color grammar Curio can render as a
 * legend swatch. It deliberately excludes named colors, variables, images,
 * gradients, and arbitrary CSS declarations.
 */
export const normalizeSafeCssColor = (
  value: string,
  options: { maxLength: number; allowImportant?: boolean },
): string | null => {
  const trimmed = value.trim();
  const important = /\s*!important\s*$/i.test(trimmed);
  if (important && !options.allowImportant) return null;
  const color = important
    ? trimmed.replace(/\s*!important\s*$/i, "").trim()
    : trimmed;
  if (color.length === 0 || color.length > options.maxLength) return null;
  if (HEX_COLOR_PATTERN.test(color)) return color;
  const functional = FUNCTIONAL_COLOR_PATTERN.exec(color);
  if (!functional) return null;
  return isValidFunctionalCssColor(
    (functional[1] ?? "").toLocaleLowerCase(),
    functional[2] ?? "",
  )
    ? color
    : null;
};
