import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";

import { navigateBackOrReplace } from "../../src/navigation/back-navigation";
import {
  normalizeNativeArticleSlug,
  normalizeNativeArticleSource,
} from "../../src/navigation/routes";
import { ArticleScreen } from "../../src/screens/ArticleScreen";
import { InvalidArticleLinkScreen } from "../../src/screens/InvalidArticleLinkScreen";

export default function ArticleRoute() {
  const router = useRouter();
  const isRouteActive = useIsFocused();
  const { from, slug } = useLocalSearchParams<{
    from?: string | string[];
    slug?: string | string[];
  }>();
  const normalizedSlug = normalizeNativeArticleSlug(slug);
  const source = normalizeNativeArticleSource(from);
  const handleBack = () =>
    navigateBackOrReplace(
      router,
      source === "library" ? "/library" : "/search",
    );

  if (normalizedSlug === null) {
    return (
      <InvalidArticleLinkScreen
        backLabel={source === "library" ? "Back to Library" : "Back to search"}
        isRouteActive={isRouteActive}
        onBack={handleBack}
      />
    );
  }

  return (
    <ArticleScreen
      backLabel={source === "library" ? "Back to Library" : "Back to search"}
      isRouteActive={isRouteActive}
      onBack={handleBack}
      onOpenAccount={() => router.push("/account")}
      slug={normalizedSlug}
    />
  );
}
