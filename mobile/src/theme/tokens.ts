export type GardenColorScheme = "light" | "dark";

const lightColors = {
  surface: "#f7f6f3",
  surface2: "#efede8",
  surface3: "#e5e2db",
  surfaceNav: "rgba(247, 246, 243, 0.88)",
  foreground: "#1a1a1a",
  foreground2: "#4b5441",
  muted: "#516247",
  border: "#d4d1c7",
  controlBorder: "#7a8273",
  accent: "#036b4a",
  accentHover: "#065f46",
  accentBg: "rgba(4, 120, 87, 0.08)",
  accentBorder: "rgba(4, 120, 87, 0.25)",
  accentGlow: "rgba(4, 120, 87, 0.1)",
  btnPrimary: "#036b4a",
  btnPrimaryHover: "#065f46",
  btnPrimaryText: "#ffffff",
  critical: "#b91c1c",
  serious: "#c2410c",
  skeletonBase: "#e5e2db",
  skeletonShine: "#efede8",
  pattern: "rgba(4, 120, 87, 0.06)",
  gradient1: "#f7f6f3",
  gradient2: "#efede8",
  gradient3: "#f7f6f3",
  gradient4: "#e6f0e8",
} as const;

export type GardenColors = {
  readonly [Token in keyof typeof lightColors]: string;
};

export const gardenColors: Readonly<Record<GardenColorScheme, GardenColors>> = {
  light: lightColors,
  dark: {
    surface: "#171717",
    surface2: "#1e1e1e",
    surface3: "#2a2a2a",
    surfaceNav: "rgba(23, 23, 23, 0.88)",
    foreground: "#f0ede6",
    foreground2: "#a8b89e",
    muted: "#909f86",
    border: "#2f2f2f",
    controlBorder: "#71806b",
    accent: "#34d399",
    accentHover: "#6ee7b7",
    accentBg: "rgba(52, 211, 153, 0.1)",
    accentBorder: "rgba(52, 211, 153, 0.2)",
    accentGlow: "rgba(52, 211, 153, 0.12)",
    btnPrimary: "#047857",
    btnPrimaryHover: "#065f46",
    btnPrimaryText: "#ffffff",
    critical: "#f87171",
    serious: "#f97316",
    skeletonBase: "#1e1e1e",
    skeletonShine: "#2a2a2a",
    pattern: "rgba(52, 211, 153, 0.04)",
    gradient1: "#171717",
    gradient2: "#1e1e1e",
    gradient3: "#171717",
    gradient4: "#172320",
  },
};

/** A four-point base scale, matching the current web theme's `--spacing`. */
export const spacing = {
  none: 0,
  hairline: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  screen: 48,
  giant: 64,
} as const;

/** Radius values mirror the current Tailwind v4 tokens in `app/globals.css`. */
export const radii = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16,
  xxxl: 24,
  xxxxl: 32,
  pill: 999,
} as const;

export type GardenColorToken = keyof GardenColors;
