import { useLocalSearchParams, useRouter } from "expo-router";

import { navigateBackOrReplace } from "../../src/navigation/back-navigation";
import { normalizeNativeArticleSlug } from "../../src/navigation/routes";
import { ArticleScreen } from "../../src/screens/ArticleScreen";
import { InvalidArticleLinkScreen } from "../../src/screens/InvalidArticleLinkScreen";

export default function ArticleRoute() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const normalizedSlug = normalizeNativeArticleSlug(slug);
  const handleBack = () => navigateBackOrReplace(router, "/search");

  if (normalizedSlug === null) {
    return <InvalidArticleLinkScreen onBack={handleBack} />;
  }

  return <ArticleScreen onBack={handleBack} slug={normalizedSlug} />;
}
