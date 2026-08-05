import { useIsFocused, useRouter } from "expo-router";

import { navigateBackOrReplace } from "../src/navigation/back-navigation";
import { LibraryScreen } from "../src/screens/LibraryScreen";

export default function LibraryRoute() {
  const router = useRouter();
  const isRouteActive = useIsFocused();

  return (
    <LibraryScreen
      isRouteActive={isRouteActive}
      onBack={() => navigateBackOrReplace(router, "/")}
      onOpenAccount={() => router.push("/account")}
      onOpenArticle={(slug) =>
        router.push({
          pathname: "/article/[slug]",
          params: { from: "library", slug },
        })
      }
      onStartExploring={() => router.replace("/")}
    />
  );
}
