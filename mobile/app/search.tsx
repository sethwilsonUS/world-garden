import { useIsFocused, useLocalSearchParams } from "expo-router";

import { SearchScreen } from "../src/screens/SearchScreen";

export default function SearchRoute() {
  const isRouteActive = useIsFocused();
  const { q } = useLocalSearchParams<{ q?: string | string[] }>();
  const term = Array.isArray(q) ? (q[0] ?? "") : (q ?? "");

  return <SearchScreen isRouteActive={isRouteActive} key={term} term={term} />;
}
