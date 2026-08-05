import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useState, type PropsWithChildren, type ReactElement } from "react";

import { NativeAuthProvider } from "../auth/NativeAuthContext";
import { ConvexNativeLibraryProvider } from "../data/ConvexNativeLibraryProvider";
import { ConvexWikipediaReaderProvider } from "../data/ConvexWikipediaReaderProvider";

export interface NativeDataAuthProviderProps extends PropsWithChildren {
  readonly clerkPublishableKey: string;
  readonly convexUrl: string;
}

/**
 * Owns the native Clerk and Convex provider graph.
 *
 * Public actions and authenticated queries deliberately share one client so a
 * signed-out reader remains available without nesting a second ConvexProvider.
 */
export function NativeDataAuthProvider({
  children,
  clerkPublishableKey,
  convexUrl,
}: NativeDataAuthProviderProps): ReactElement {
  const [convexClient] = useState(() => new ConvexReactClient(convexUrl));

  return (
    <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
      <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
        <ConvexWikipediaReaderProvider>
          <NativeAuthProvider>
            <ConvexNativeLibraryProvider>
              {children}
            </ConvexNativeLibraryProvider>
          </NativeAuthProvider>
        </ConvexWikipediaReaderProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
