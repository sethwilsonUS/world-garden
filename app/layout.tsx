import type { Metadata } from "next";
import { Fraunces, DM_Sans, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import {
  getActiveTtsProfile,
  getTtsMetadata,
  serializeTtsMetadataForInlineScript,
} from "@/lib/tts-profile";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  ),
  title: "Curio Garden — Listen to Wikipedia",
  description:
    "An accessibility-first web app that turns Wikipedia articles into audio you can listen to right in your browser.",
  openGraph: {
    type: "website",
    siteName: "Curio Garden",
  },
  twitter: {
    card: "summary_large_image",
  },
};

const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    var theme = stored || (prefersLight ? 'light' : 'dark');
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f7f6f3' : '#171717');
  } catch(e) {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();
`;

// Safari does not yet expose the cross-browser text-scale meta behavior. On
// touch Apple devices, use the system Dynamic Type body style as a measuring
// probe, then keep the site's own typefaces while adopting the measured size.
// This runs in the head so the first painted frame already uses the right root.
const osTextScaleInitScript = `
(function() {
  try {
    var root = document.documentElement;
    var isTouchApple = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isTouchApple || !window.CSS || !CSS.supports('font', '-apple-system-body')) return;

    var frame = 0;
    var sync = function() {
      frame = 0;
      var probe = document.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;inset:auto;font:-apple-system-body;line-height:1;';
      root.appendChild(probe);
      var measured = parseFloat(getComputedStyle(probe).fontSize);
      probe.remove();
      if (Number.isFinite(measured) && measured > 0) {
        var nextSize = Math.max(16, measured) + 'px';
        var previousSize = root.style.getPropertyValue('--os-text-base');
        if (nextSize !== previousSize) {
          root.style.setProperty('--os-text-base', nextSize);
          if (previousSize) {
            dispatchEvent(new CustomEvent('curio:text-scale-change', {
              detail: { fontSize: nextSize }
            }));
          }
        }
      }
    };
    var schedule = function() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    sync();
    addEventListener('pageshow', schedule, { passive: true });
    addEventListener('orientationchange', schedule, { passive: true });
    addEventListener('resize', schedule, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', schedule, { passive: true });
    }
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') schedule();
    });
  } catch (error) {
    // Keep the normal 100% root size when a WebKit build cannot expose the
    // system text style. Browser zoom and reflow remain available.
  }
})();
`;

const themeToggleCss = `
.theme-icon-sun, .theme-icon-moon { display: none; }
.dark .theme-icon-sun { display: inline-flex; }
.light .theme-icon-moon { display: inline-flex; }
`;

const activeTtsMetadataScript = `window.__CURIO_ACTIVE_TTS_METADATA__=${serializeTtsMetadataForInlineScript(
  getTtsMetadata(getActiveTtsProfile()),
)};`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="text-scale" content="scale" />
        <script dangerouslySetInnerHTML={{ __html: osTextScaleInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: activeTtsMetadataScript }} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style dangerouslySetInnerHTML={{ __html: themeToggleCss }} />
        <link
          rel="manifest"
          href="/manifest.json"
          crossOrigin="use-credentials"
        />
        <meta name="theme-color" content="#171717" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Curio Garden" />
      </head>
      <body
        className={`${fraunces.variable} ${dmSans.variable} ${jetbrainsMono.variable} antialiased animated-bg`}
        style={{ fontFamily: "var(--font-body), system-ui, sans-serif" }}
      >
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
