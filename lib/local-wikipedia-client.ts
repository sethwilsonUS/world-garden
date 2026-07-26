import type {
  LocalWikipediaRequest,
  LocalWikipediaResponseFor,
} from "@/lib/wikipedia-contracts";

type LocalWikipediaEnvelope<Value> = { data: Value } | { error: string };

export const requestLocalWikipedia = async <
  Request extends LocalWikipediaRequest,
>(
  request: Request,
  signal?: AbortSignal,
): Promise<LocalWikipediaResponseFor<Request>> => {
  const response = await fetch("/api/local-wikipedia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const payload = (await response.json()) as LocalWikipediaEnvelope<
    LocalWikipediaResponseFor<Request>
  >;
  if (!response.ok || "error" in payload) {
    throw new Error(
      "error" in payload ? payload.error : "Local Wikipedia request failed",
    );
  }
  return payload.data;
};
