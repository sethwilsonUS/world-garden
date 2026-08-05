import { useLocalSearchParams, useRouter } from "expo-router";

import { navigateBackOrReplace } from "../../src/navigation/back-navigation";
import { normalizeNativeArticleSlug } from "../../src/navigation/routes";
import { InvalidArticleLinkScreen } from "../../src/screens/InvalidArticleLinkScreen";
import { WebArticleHandoffScreen } from "../../src/screens/WebArticleHandoffScreen";

export default function ArticleHandoffRoute() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const normalizedSlug = normalizeNativeArticleSlug(slug);
  const handleBack = () => navigateBackOrReplace(router, "/search");

  if (normalizedSlug === null) {
    return <InvalidArticleLinkScreen onBack={handleBack} />;
  }

  return (
    <WebArticleHandoffScreen
      onBack={handleBack}
      slug={normalizedSlug}
    />
  );
}
