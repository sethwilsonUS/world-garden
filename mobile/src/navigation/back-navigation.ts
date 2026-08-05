export type NativeBackFallback = "/" | "/library" | "/search";

type BackNavigation = Readonly<{
  back(): void;
  canGoBack(): boolean;
  replace(path: NativeBackFallback): void;
}>;

/** Preserve navigation history when it exists and provide an honest cold-link fallback. */
export function navigateBackOrReplace(
  router: BackNavigation,
  fallback: NativeBackFallback,
): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallback);
}
