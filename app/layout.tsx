import type { Metadata } from "next";
import { Fraunces, DM_Sans, JetBrains_Mono } from "next/font/google";
import { AppProviders } from "./AppProviders";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AccessibleLayout } from "@/components/AccessibleLayout";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
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
  title: "World Garden — Listen to Wikipedia",
  description:
    "An accessibility-first web app that turns Wikipedia articles into audio you can listen to right in your browser.",
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

const themeToggleCss = `
.theme-icon-sun, .theme-icon-moon { display: none; }
.dark .theme-icon-sun { display: inline-flex; }
.light .theme-icon-moon { display: inline-flex; }
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style dangerouslySetInnerHTML={{ __html: themeToggleCss }} />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#171717" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="World Garden" />
      </head>
      <body
        className={`${fraunces.variable} ${dmSans.variable} ${jetbrainsMono.variable} antialiased animated-bg`}
        style={{ fontFamily: "var(--font-body), system-ui, sans-serif" }}
      >
        <AppProviders>
          <ThemeProvider>
            <AccessibleLayout>{children}</AccessibleLayout>
          </ThemeProvider>
        </AppProviders>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
