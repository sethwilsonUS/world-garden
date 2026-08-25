import { useConvex } from "convex/react";
import { useCallback, useMemo } from "react";

import { convexClientApi } from "./convexClientApi";

export type NativeListeningProgressQueryArgs = Readonly<{
  expectedAccountSubject: string;
  sessionEpochKey: string;
  wikiPageId: string;
}>;

export interface NativeListeningProgressQueryClient {
  readonly getNative: (
    args: NativeListeningProgressQueryArgs,
  ) => Promise<unknown>;
}

/** Owns the one Convex client query used by the listening-progress adapter. */
export function useNativeListeningProgressQueryClient(): NativeListeningProgressQueryClient {
  const convex = useConvex();
  const getNative = useCallback(
    (args: NativeListeningProgressQueryArgs): Promise<unknown> =>
      convex.query(convexClientApi.listeningProgress.getNative, args),
    [convex],
  );

  return useMemo(() => ({ getNative }), [getNative]);
}
