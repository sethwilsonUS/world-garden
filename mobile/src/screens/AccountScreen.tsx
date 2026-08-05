import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { useHostedAuthFlow } from "../auth/HostedAuthFlow";
import { useNativeAuth, type NativeAuthState } from "../auth/NativeAuthContext";
import { AccessibleStatus } from "../components/AccessibleStatus";
import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import {
  RouteHeading,
  type RouteHeadingProps,
} from "../components/RouteHeading";
import { GardenScreen } from "../layout/GardenScreen";
import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";

const BRIDGE_ERROR_MESSAGE =
  "We couldn't connect your account. Please try again.";
const SIGN_OUT_ERROR_MESSAGE = "We couldn't sign you out. Please try again.";

type SignOutOperation = {
  kind: "idle" | "busy" | "error";
  sessionEpoch: symbol | null;
};

type PendingSignOutFocus = {
  generation: number;
  sessionEpoch: symbol;
};

type AccountPresentation = {
  body: string;
  eyebrow: string;
  status: string;
  title: string;
};

type AccountStatusPresentation = {
  isError: boolean;
  message: string;
  source: "authError" | "hostedBusy" | "presentation" | "signOut";
};

export interface AccountScreenProps {
  focusAuthOpener?: (element: View) => void;
  focusHeading?: NonNullable<RouteHeadingProps["focusElement"]>;
  isProductionEnvironment: boolean;
  onBack: () => void;
}

function focusNativeElement(element: View) {
  AccessibilityInfo.sendAccessibilityEvent(element, "focus");
}

function normalizeProfileValue(value: string | null): string {
  const normalized = value
    ?.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return normalized || "Not provided";
}

function presentationFor(state: NativeAuthState): AccountPresentation {
  switch (state.status) {
    case "loading":
      return {
        body: "Account shortcuts will appear here when the session is ready.",
        eyebrow: "Account",
        status: "Checking your account session.",
        title: "Checking session",
      };
    case "signedOut":
      return {
        body: "Curio Garden stays public without an account. Sign in to connect an account to this device.",
        eyebrow: "Guest mode",
        status: "You are browsing in guest mode.",
        title: "Browse now, sign in anytime",
      };
    case "connecting":
      return {
        body: "Your account session is connecting securely.",
        eyebrow: "Account",
        status: "Connecting your account.",
        title: "Connecting your account",
      };
    case "bridgeError":
      return {
        body: "Browsing still works. Account controls will return when the connection recovers.",
        eyebrow: "Account",
        status: BRIDGE_ERROR_MESSAGE,
        title: "Account connection paused",
      };
    case "ready":
      return {
        body: "Review the name and email connected to this device, or sign out when you're finished.",
        eyebrow: "Signed in",
        status: "Your account is connected.",
        title: "Welcome back",
      };
  }
}

interface AccountSignInButtonProps {
  busy: boolean;
  onPress: () => void;
}

const AccountSignInButton = forwardRef<View, AccountSignInButtonProps>(
  function AccountSignInButton({ busy, onPress }, ref): ReactElement {
    const { colors, fonts, radii, spacing } = useGardenTheme();
    const [focused, setFocused] = useState(false);
    const visibleLabel = busy ? "Sign in — in progress" : "Sign in";

    return (
      <Pressable
        ref={ref}
        accessible
        accessibilityHint="Opens secure browser sign-in or account creation."
        accessibilityLabel={visibleLabel}
        accessibilityRole="button"
        accessibilityState={{ busy }}
        focusable
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={onPress}
        style={({ pressed }) => [
          styles.signInButton,
          {
            backgroundColor: colors.btnPrimary,
            borderColor: colors.btnPrimary,
            borderRadius: radii.xl,
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
          },
          pressed && !busy
            ? [styles.pressed, { backgroundColor: colors.btnPrimaryHover }]
            : undefined,
          focused && !busy
            ? [
                styles.focused,
                {
                  borderColor: colors.btnPrimaryText,
                  outlineColor: colors.accent,
                },
              ]
            : undefined,
          busy ? styles.unavailable : undefined,
          styles.minimumTarget,
        ]}
      >
        {({ pressed }) => (
          <GardenText
            accessible={false}
            color="btnPrimaryText"
            style={[
              styles.signInLabel,
              { fontFamily: fonts.bodySemiBold },
              (pressed || focused) && !busy
                ? styles.interactionLabel
                : undefined,
            ]}
          >
            {visibleLabel}
          </GardenText>
        )}
      </Pressable>
    );
  },
);

function ProfileField({ label, value }: { label: string; value: string }) {
  const { colors, spacing } = useGardenTheme();

  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}`}
      style={[
        styles.profileField,
        {
          borderColor: colors.border,
          gap: spacing.xs,
          paddingVertical: spacing.md,
        },
      ]}
    >
      <GardenText accessible={false} color="muted" variant="eyebrow">
        {label}
      </GardenText>
      <GardenText accessible={false}>{value}</GardenText>
    </View>
  );
}

export function AccountScreen({
  focusAuthOpener = focusNativeElement,
  focusHeading,
  isProductionEnvironment,
  onBack,
}: AccountScreenProps): ReactElement {
  const {
    authErrorMessage,
    isAccessibilityActive,
    isBusy: isHostedAuthBusy,
    openAuth,
  } = useHostedAuthFlow();
  const { canSignOut, sessionEpoch, signOut, state } = useNativeAuth();
  const focusAccountHeading = focusHeading ?? focusNativeElement;
  const accountHeadingRef = useRef<View>(null);
  const signInButtonRef = useRef<View>(null);
  const signOutGeneration = useRef(0);
  const pendingSignOutFocusRef = useRef<PendingSignOutFocus | null>(null);
  const latestSessionEpochRef = useRef(sessionEpoch);
  const [signOutOperation, setSignOutOperation] = useState<SignOutOperation>({
    kind: "idle",
    sessionEpoch: null,
  });

  useLayoutEffect(() => {
    latestSessionEpochRef.current = sessionEpoch;
  }, [sessionEpoch]);

  useEffect(
    () => () => {
      signOutGeneration.current += 1;
      pendingSignOutFocusRef.current = null;
    },
    [],
  );

  const effectiveSignOutOperation =
    signOutOperation.sessionEpoch === sessionEpoch
      ? signOutOperation.kind
      : "idle";
  const presentation =
    effectiveSignOutOperation === "busy"
      ? {
          body: "Ending the account session on this device and clearing private account details from view.",
          eyebrow: "Account",
          status: "Signing out.",
          title: "Signing out",
        }
      : presentationFor(state);
  const statusPresentation: AccountStatusPresentation =
    effectiveSignOutOperation === "busy"
      ? { isError: false, message: "Signing out.", source: "signOut" }
      : effectiveSignOutOperation === "error"
        ? {
            isError: true,
            message: SIGN_OUT_ERROR_MESSAGE,
            source: "signOut",
          }
        : isHostedAuthBusy
          ? {
              isError: false,
              message: "Opening secure sign-in.",
              source: "hostedBusy",
            }
          : authErrorMessage !== null
            ? {
                isError: true,
                message: authErrorMessage,
                source: "authError",
              }
            : {
                isError: state.status === "bridgeError",
                message: presentation.status,
                source: "presentation",
              };
  const statusIsBusy =
    effectiveSignOutOperation === "busy" ||
    isHostedAuthBusy ||
    state.status === "loading" ||
    state.status === "connecting";

  useEffect(() => {
    const pendingFocus = pendingSignOutFocusRef.current;
    if (!pendingFocus) return;

    if (pendingFocus.generation !== signOutGeneration.current) {
      pendingSignOutFocusRef.current = null;
      return;
    }
    if (
      pendingFocus.sessionEpoch !== sessionEpoch &&
      state.status !== "signedOut"
    ) {
      pendingSignOutFocusRef.current = null;
      return;
    }
    if (
      state.status !== "signedOut" ||
      effectiveSignOutOperation === "busy"
    ) {
      return;
    }

    pendingSignOutFocusRef.current = null;
    const opener = signInButtonRef.current;
    if (opener) {
      focusAuthOpener(opener);
      return;
    }

    const accountHeading = accountHeadingRef.current;
    if (accountHeading) focusAccountHeading(accountHeading);
  }, [
    effectiveSignOutOperation,
    focusAccountHeading,
    focusAuthOpener,
    sessionEpoch,
    state.status,
  ]);

  const openSignIn = useCallback(() => {
    void openAuth({
      restoreFocus: (outcome) => {
        const accountHeading = accountHeadingRef.current;
        if (outcome === "completed") {
          if (accountHeading) focusAccountHeading(accountHeading);
          return;
        }

        const opener = signInButtonRef.current;
        if (opener) {
          focusAuthOpener(opener);
          return;
        }

        if (accountHeading) focusAccountHeading(accountHeading);
      },
    });
  }, [focusAccountHeading, focusAuthOpener, openAuth]);

  const performSignOut = async () => {
    if (effectiveSignOutOperation === "busy") return;

    const generation = ++signOutGeneration.current;
    const startingSessionEpoch = sessionEpoch;
    pendingSignOutFocusRef.current = {
      generation,
      sessionEpoch: startingSessionEpoch,
    };
    setSignOutOperation({ kind: "busy", sessionEpoch: startingSessionEpoch });

    let result;
    try {
      result = await signOut();
    } catch (error: unknown) {
      void error;
      result = { ok: false } as const;
    }

    if (generation !== signOutGeneration.current) {
      return;
    }
    if (latestSessionEpochRef.current !== startingSessionEpoch) {
      return;
    }

    if (!result.ok) pendingSignOutFocusRef.current = null;

    setSignOutOperation({
      kind: result.ok ? "idle" : "error",
      sessionEpoch: startingSessionEpoch,
    });
  };

  const profile =
    state.status === "ready"
      ? {
          email: normalizeProfileValue(state.profile.email),
          name: normalizeProfileValue(state.profile.name),
        }
      : null;

  return (
    <GardenScreen
      contentContainerStyle={styles.content}
      testID="account-screen"
    >
      <GardenButton
        hint="Returns to Curio Garden home."
        label="Back to garden"
        onPress={onBack}
        variant="secondary"
      />

      <RouteHeading
        ref={accountHeadingRef}
        focusElement={focusAccountHeading}
        focusKey="account"
        testID="account-screen-heading"
        title="Account & data"
      />
      <GardenText color="foreground2" variant="intro">
        {isProductionEnvironment
          ? "Review the account connected to this device. Web account controls need a verified handoff before this app can open them."
          : "Review the test account connected to this device. This build never hands its test identity to production account controls."}
      </GardenText>

      <AccessibleStatus
        accessible={!isAccessibilityActive}
        announceOnReveal={statusPresentation.source === "authError"}
        announcementMode={isHostedAuthBusy ? "none" : "imperative"}
        accessibilityRole={statusPresentation.isError ? "alert" : undefined}
        accessibilityState={{ busy: statusIsBusy }}
        color={statusPresentation.isError ? "critical" : "foreground2"}
        message={statusPresentation.message}
        testID="account-status"
      />

      <GardenCard testID="account-state-card">
        <GardenText color="accent" variant="eyebrow">
          {presentation.eyebrow}
        </GardenText>
        <GardenText accessibilityRole="header" variant="sectionTitle">
          {presentation.title}
        </GardenText>
        <GardenText color="foreground2">{presentation.body}</GardenText>

        {profile ? (
          <View accessible={false} style={styles.profileFields}>
            <ProfileField label="Name" value={profile.name} />
            <ProfileField label="Email" value={profile.email} />
          </View>
        ) : null}

        {state.status === "signedOut" &&
        effectiveSignOutOperation !== "busy" ? (
          <AccountSignInButton
            ref={signInButtonRef}
            busy={isHostedAuthBusy}
            onPress={openSignIn}
          />
        ) : null}

        {canSignOut || effectiveSignOutOperation === "busy" ? (
          <GardenButton
            busy={effectiveSignOutOperation === "busy"}
            hint="Ends the account session on this device."
            label="Sign out"
            onPress={() => void performSignOut()}
            variant="secondary"
          />
        ) : null}
      </GardenCard>

      <GardenCard testID="account-lifecycle-card">
        <GardenText color="accent" variant="eyebrow">
          Account lifecycle
        </GardenText>
        <GardenText accessibilityRole="header" variant="sectionTitle">
          Web handoff paused
        </GardenText>
        <GardenText color="foreground2">
          {isProductionEnvironment
            ? "The app will not open web account controls until it can verify that the browser and this device use the same account."
            : "This non-production build uses a separate test account. Export and permanent deletion are unavailable in the app."}
        </GardenText>
      </GardenCard>
    </GardenScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 24,
  },
  focused: {
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 3,
  },
  interactionLabel: {
    textDecorationLine: "underline",
  },
  minimumTarget: {
    minHeight: 48,
    minWidth: 48,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  profileField: {
    borderBottomWidth: 1,
  },
  profileFields: {
    alignSelf: "stretch",
  },
  signInButton: {
    alignItems: "center",
    alignSelf: "stretch",
    borderWidth: 2,
    justifyContent: "center",
  },
  signInLabel: {
    textAlign: "center",
  },
  unavailable: {
    opacity: 0.55,
  },
});
