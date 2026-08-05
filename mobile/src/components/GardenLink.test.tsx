import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Linking, StyleSheet } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { GardenLink, normalizeSafeExternalUrl } from "./GardenLink";

const validUrl = "https://example.org/long/path?topic=garden#history";
const validExternalUrls = [
  "https://example.org",
  "HTTPS://example.org/a?b=c#d",
  "https://例え.テスト/庭",
  "https://192.0.2.42/source",
  "https://garden-tools.example/source",
  "https://example.org:8443/source",
];

// Mirrors the URL properties GardenLink reads from React Native 0.86.2's
// lightweight Libraries/Blob/URL implementation.
class ReactNativeLightweightUrl {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  get hostname() {
    const match = this.value.match(/^https?:\/\/(?:[^@]+@)?([^:/?#]+)/);
    return match ? match[1] : "";
  }

  get password() {
    const match = this.value.match(/https?:\/\/.*:(.*)@/);
    return match ? match[1] : "";
  }

  get protocol() {
    const match = this.value.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
    return match ? `${match[1]}:` : "";
  }

  get username() {
    const match = this.value.match(/^https?:\/\/([^:@]+)(?::[^@]*)?@/);
    return match ? match[1] : "";
  }
}

function withReactNativeLightweightUrl<Result>(run: () => Result): Result {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "URL");
  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    value: ReactNativeLightweightUrl,
    writable: true,
  });

  try {
    return run();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "URL", originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "URL");
    }
  }
}

function renderLink(
  overrides: Partial<React.ComponentProps<typeof GardenLink>> = {},
) {
  const props = {
    hint: "Opens the source in your browser.",
    label: "Read the original source",
    onOpenError: jest.fn(),
    onOpenStart: jest.fn(),
    openUrl: jest.fn().mockResolvedValue(undefined),
    testID: "source-link",
    url: validUrl,
    ...overrides,
  };

  const view = render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <GardenLink {...props} />
    </GardenThemeProvider>,
  );

  return { ...props, unmount: view.unmount };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("normalizeSafeExternalUrl", () => {
  it.each(validExternalUrls)(
    "keeps the original credential-free HTTPS URL: %s",
    (url) => {
      expect(normalizeSafeExternalUrl(url)).toBe(url);
    },
  );

  it.each([
    "",
    "not a URL",
    "https:example.org",
    "http://example.org",
    "mailto:garden@example.org",
    "curiogarden://article/Orchid",
    "https://user@example.org",
    "https://user:secret@example.org",
    "https://example.org/a path",
    "https://example.org/a\npath",
    "https://example.org/\u0000path",
    "https://",
    "https://example.org:invalid",
  ])("rejects unsafe or malformed input: %p", (url) => {
    expect(normalizeSafeExternalUrl(url)).toBeNull();
  });

  it.each([
    "https://example.org:invalid/source",
    "https://example.org:65536/source",
  ])(
    "rejects an invalid port with React Native's lightweight URL implementation: %p",
    (url) => {
      withReactNativeLightweightUrl(() => {
        expect(normalizeSafeExternalUrl(url)).toBeNull();
      });
    },
  );

  it("rejects backslash host confusion with React Native's lightweight URL implementation", () => {
    withReactNativeLightweightUrl(() => {
      expect(
        normalizeSafeExternalUrl(String.raw`https://example.org\evil`),
      ).toBeNull();
    });
  });

  it("rejects a bracketed literal host with React Native's lightweight URL implementation", () => {
    withReactNativeLightweightUrl(() => {
      expect(normalizeSafeExternalUrl("https://[not-ipv6]/source")).toBeNull();
    });
  });

  it("rejects percent-encoded host delimiters with React Native's lightweight URL implementation", () => {
    withReactNativeLightweightUrl(() => {
      expect(
        normalizeSafeExternalUrl("https://%2Fexample.org/source"),
      ).toBeNull();
    });
  });

  it.each([
    "https://.example.org/source",
    "https://example..org/source",
    "https://example.org./source",
  ])(
    "rejects an empty DNS label with React Native's lightweight URL implementation: %p",
    (url) => {
      withReactNativeLightweightUrl(() => {
        expect(normalizeSafeExternalUrl(url)).toBeNull();
      });
    },
  );

  it.each([
    "https://-example.org/source",
    "https://example-.org/source",
  ])(
    "rejects a misplaced DNS-label hyphen with React Native's lightweight URL implementation: %p",
    (url) => {
      withReactNativeLightweightUrl(() => {
        expect(normalizeSafeExternalUrl(url)).toBeNull();
      });
    },
  );

  it.each([
    "https://256.0.0.1/source",
    "https://127.1/source",
    "https://01.2.3.4/source",
    "https://0x7f.0.0.1/source",
    "https://1.2.3.4.5/source",
  ])(
    "rejects a noncanonical or out-of-range IPv4 host with React Native's lightweight URL implementation: %p",
    (url) => {
      withReactNativeLightweightUrl(() => {
        expect(normalizeSafeExternalUrl(url)).toBeNull();
      });
    },
  );

  it.each([
    "https://exa_mple.org/source",
    "https://example;evil.org/source",
    "https://🌿.example/source",
    "https://zero\u200bwidth.example/source",
    `https://${"a".repeat(64)}.example/source`,
  ])(
    "rejects forbidden DNS-label syntax with React Native's lightweight URL implementation: %p",
    (url) => {
      withReactNativeLightweightUrl(() => {
        expect(normalizeSafeExternalUrl(url)).toBeNull();
      });
    },
  );

  it.each(validExternalUrls)(
    "keeps valid HTTPS with React Native's lightweight URL implementation: %s",
    (url) => {
      withReactNativeLightweightUrl(() => {
        expect(normalizeSafeExternalUrl(url)).toBe(url);
      });
    },
  );

  it.each(["https://", "https:///source", "https://?topic=garden"])(
    "rejects a missing host with React Native's lightweight URL implementation: %p",
    (url) => {
      withReactNativeLightweightUrl(() => {
        expect(normalizeSafeExternalUrl(url)).toBeNull();
      });
    },
  );
});

describe("GardenLink", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the full visible label as its accessible link name", () => {
    renderLink();

    const link = screen.getByRole("link", {
      name: "Read the original source",
    });
    const label = screen.getByText("Read the original source");

    expect(link).toHaveProp(
      "accessibilityHint",
      "Opens the source in your browser.",
    );
    expect(link).toHaveProp("accessibilityLabel", "Read the original source");
    expect(label).toHaveProp("accessible", false);
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.adjustsFontSizeToFit).toBeUndefined();
  });

  it("opens on release and reports launch lifecycle without raw errors", async () => {
    const rawError = new Error("private operating-system detail");
    const props = renderLink({
      openUrl: jest.fn().mockRejectedValue(rawError),
    });
    const link = screen.getByRole("link", {
      name: "Read the original source",
    });

    fireEvent(link, "pressIn");
    fireEvent(link, "pressOut");
    expect(props.onOpenStart).not.toHaveBeenCalled();
    expect(props.openUrl).not.toHaveBeenCalled();

    fireEvent.press(link);
    expect(props.onOpenStart).toHaveBeenCalledTimes(1);
    expect(props.openUrl).toHaveBeenCalledWith(validUrl);
    const attempt = jest.mocked(props.onOpenStart).mock.calls[0]?.[0];
    expect(typeof attempt).toBe("symbol");

    await waitFor(() => expect(props.onOpenError).toHaveBeenCalledTimes(1));
    expect(props.onOpenError).toHaveBeenCalledWith(attempt);
  });

  it("uses the native URL launcher by default", async () => {
    const openUrl = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(undefined as never);
    const props = renderLink({ openUrl: undefined });

    fireEvent.press(
      screen.getByRole("link", { name: "Read the original source" }),
    );

    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(validUrl));
    expect(props.onOpenStart).toHaveBeenCalledTimes(1);
    expect(props.onOpenError).not.toHaveBeenCalled();
  });

  it("ignores a rejected launch after unmount", async () => {
    const request = deferred<unknown>();
    const props = renderLink({
      openUrl: jest.fn().mockReturnValue(request.promise),
    });

    fireEvent.press(
      screen.getByRole("link", { name: "Read the original source" }),
    );
    props.unmount();
    request.reject(new Error("late operating-system detail"));

    await expect(request.promise).rejects.toThrow(
      "late operating-system detail",
    );
    expect(props.onOpenError).not.toHaveBeenCalled();
  });

  it("ignores an older failure after a newer launch starts", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const props = renderLink({
      openUrl: jest
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    });
    const link = screen.getByRole("link", {
      name: "Read the original source",
    });

    fireEvent.press(link);
    fireEvent.press(link);
    first.reject(new Error("stale operating-system detail"));
    await expect(first.promise).rejects.toThrow(
      "stale operating-system detail",
    );
    expect(props.onOpenError).not.toHaveBeenCalled();

    second.reject(new Error("current operating-system detail"));
    await expect(second.promise).rejects.toThrow(
      "current operating-system detail",
    );
    await waitFor(() => expect(props.onOpenError).toHaveBeenCalledTimes(1));
  });

  it("invalidates a pending launch when its destination changes", async () => {
    const request = deferred<unknown>();
    const onOpenError = jest.fn();
    const openUrl = jest.fn().mockReturnValue(request.promise);
    const view = render(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <GardenLink
          label="Read the original source"
          onOpenError={onOpenError}
          openUrl={openUrl}
          url={validUrl}
        />
      </GardenThemeProvider>,
    );

    fireEvent.press(
      screen.getByRole("link", { name: "Read the original source" }),
    );
    view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <GardenLink
          label="Read the original source"
          onOpenError={onOpenError}
          openUrl={openUrl}
          url="https://example.org/replacement"
        />
      </GardenThemeProvider>,
    );
    request.reject(new Error("obsolete destination failure"));

    await expect(request.promise).rejects.toThrow(
      "obsolete destination failure",
    );
    expect(onOpenError).not.toHaveBeenCalled();
  });

  it("has a 48-point target plus non-color pressed and focus cues", () => {
    renderLink({ testOnly_pressed: true });
    const link = screen.getByRole("link", {
      name: "Read the original source",
    });
    const label = screen.getByText("Read the original source");

    expect(StyleSheet.flatten(link.props.style)).toMatchObject({
      minHeight: 48,
      minWidth: 48,
      transform: [{ translateY: 1 }],
    });
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({
      textDecorationLine: "underline",
      textDecorationStyle: "dashed",
    });

    fireEvent(link, "focus");
    expect(StyleSheet.flatten(link.props.style)).toMatchObject({
      outlineOffset: 2,
      outlineStyle: "solid",
      outlineWidth: 3,
    });
  });

  it("renders unsafe destinations as honest noninteractive text", () => {
    const props = renderLink({ url: "javascript:alert('nope')" });
    const fallback = screen.getByTestId("source-link");

    expect(screen.queryByRole("link")).not.toBeOnTheScreen();
    expect(fallback).toHaveTextContent(
      "Read the original source — link unavailable",
    );
    expect(fallback).toHaveAccessibleName(
      "Read the original source — link unavailable",
    );
    expect(fallback.props.onPress).toBeUndefined();
    expect(fallback.props.focusable).toBeUndefined();

    fireEvent.press(fallback);
    expect(props.onOpenStart).not.toHaveBeenCalled();
    expect(props.openUrl).not.toHaveBeenCalled();
    expect(props.onOpenError).not.toHaveBeenCalled();
  });
});
