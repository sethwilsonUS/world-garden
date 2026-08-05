import { useLocalSearchParams, useRouter } from "expo-router";

import { navigateBackOrReplace } from "../../src/navigation/back-navigation";
import { WebArticleHandoffScreen } from "../../src/screens/WebArticleHandoffScreen";

export default function ArticleHandoffRoute() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const normalizedSlug = Array.isArray(slug) ? slug[0] : slug;

  return (
    <WebArticleHandoffScreen
      onBack={() => navigateBackOrReplace(router, "/search")}
      slug={normalizedSlug?.trim() || "Wikipedia article"}
    />
  );
}
