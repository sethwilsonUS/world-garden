import { useLocalSearchParams } from "expo-router";

import { SearchScreen } from "../src/screens/SearchScreen";

export default function SearchRoute() {
  const { q } = useLocalSearchParams<{ q?: string | string[] }>();
  const term = Array.isArray(q) ? (q[0] ?? "") : (q ?? "");

  return <SearchScreen key={term} term={term} />;
}
