"use client";

import { ReactNode } from "react";
import dynamic from "next/dynamic";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

const ConvexDataProvider = isLocal
  ? null
  : dynamic(
      () =>
        import("@/lib/convex-data-provider").then((m) => m.ConvexDataProvider),
      { ssr: true },
    );

const LocalDataProvider = isLocal
  ? dynamic(
      () =>
        import("@/lib/local-data-provider").then((m) => m.LocalDataProvider),
      { ssr: true },
    )
  : null;

const LocalModeBanner = isLocal
  ? dynamic(
      () =>
        import("@/components/LocalModeBanner").then((m) => m.LocalModeBanner),
      { ssr: true },
    )
  : null;

export const AppProviders = ({ children }: { children: ReactNode }) => {
  if (isLocal && LocalDataProvider) {
    return (
      <LocalDataProvider>
        {LocalModeBanner && <LocalModeBanner />}
        {children}
      </LocalDataProvider>
    );
  }

  if (ConvexDataProvider) {
    return <ConvexDataProvider>{children}</ConvexDataProvider>;
  }

  return <>{children}</>;
};
