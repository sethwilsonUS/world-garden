interface RgbColor {
  blue: number;
  green: number;
  red: number;
}

function parseHexColor(hexColor: string): RgbColor {
  const normalized = hexColor.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? [...normalized].map((digit) => `${digit}${digit}`).join("")
      : normalized;

  if (!/^[\da-f]{6}$/i.test(expanded)) {
    throw new Error(
      `Expected a three- or six-digit hex color, received: ${hexColor}`,
    );
  }

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function linearize(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hexColor: string): number {
  const { red, green, blue } = parseHexColor(hexColor);
  return (
    0.2126 * linearize(red) +
    0.7152 * linearize(green) +
    0.0722 * linearize(blue)
  );
}

/** WCAG 2.x relative-luminance contrast ratio, from 1:1 through 21:1. */
export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}
