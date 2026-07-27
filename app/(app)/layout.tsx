import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AppProviders } from "../AppProviders";
import { AccessibleLayout } from "@/components/AccessibleLayout";
import { AuthNavControls } from "@/components/AuthNavControls";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TrendingBriefWarmup } from "@/components/TrendingBriefWarmup";
import { PublicTtsProfileProvider } from "@/lib/tts-audience";

const clerkAppearance = {
  variables: {
    colorPrimary: "var(--color-accent)",
    colorForeground: "var(--color-foreground)",
    colorBackground: "var(--color-surface-2)",
    colorText: "var(--color-foreground)",
    colorTextSecondary: "var(--color-muted)",
    colorInputBackground: "var(--color-surface)",
    colorInputText: "var(--color-foreground)",
    colorDanger: "var(--color-critical)",
    borderRadius: "0.75rem",
    fontFamily: "var(--font-body), system-ui, sans-serif",
  },
  elements: {
    card: "border border-border bg-surface-2 shadow-[0_24px_80px_rgba(0,0,0,0.22)]",
    headerTitle: "font-display text-foreground",
    headerSubtitle: "text-muted",
    formButtonPrimary:
      "bg-btn-primary text-btn-primary-text hover:bg-btn-primary-hover focus-visible:ring-2 focus-visible:ring-accent",
    footerActionLink: "text-accent hover:text-accent-hover",
    userButtonPopoverCard:
      "border border-border bg-surface-2 text-foreground shadow-[0_18px_60px_rgba(0,0,0,0.24)]",
    userButtonPopoverActionButton: "text-foreground hover:bg-surface-3",
  },
};

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

// Keep Clerk below the root layout: static-looking 404s bypass proxy.ts and
// must remain renderable without Clerk middleware state.
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shell = (
    <>
      <AppProviders>
        <ThemeProvider>
          <AccessibleLayout
            authEnabled={!isLocal}
            authControls={isLocal ? undefined : <AuthNavControls />}
            mobileAuthControls={
              isLocal ? undefined : <AuthNavControls mobile />
            }
          >
            {children}
          </AccessibleLayout>
        </ThemeProvider>
      </AppProviders>
      <TrendingBriefWarmup />
      <ServiceWorkerRegistration />
      <Analytics />
      <SpeedInsights />
    </>
  );

  return isLocal ? (
    <PublicTtsProfileProvider>{shell}</PublicTtsProfileProvider>
  ) : (
    <ClerkProvider
      dynamic
      appearance={clerkAppearance}
      signInUrl="/sign-in"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      {shell}
    </ClerkProvider>
  );
}
