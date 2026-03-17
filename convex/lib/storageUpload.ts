import { type Id } from "../_generated/dataModel";

export const uploadBlobToConvexStorage = async (
  uploadUrl: string,
  blob: Blob,
): Promise<Id<"_storage">> => {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/mpeg" },
    body: blob,
  });

  if (!response.ok) {
    throw new Error(`Convex storage upload failed: ${response.status}`);
  }

  const body = (await response.json()) as { storageId?: Id<"_storage"> };
  if (!body.storageId) {
    throw new Error("Convex storage upload did not return a storageId");
  }

  return body.storageId;
};

export const uploadStreamToConvexStorage = async (
  uploadUrl: string,
  stream: ReadableStream<Uint8Array>,
  contentType = "audio/mpeg",
): Promise<{ storageId: Id<"_storage">; byteLength: number }> => {
  let byteLength = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const countingStream = new ReadableStream<Uint8Array>({
    start(controller) {
      reader = stream.getReader();

      const pump = async () => {
        try {
          while (reader) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }

            if (value) {
              byteLength += value.byteLength;
              controller.enqueue(value);
            }
          }
        } catch (error) {
          controller.error(error);
        }
      };

      void pump();
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: countingStream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  if (!response.ok) {
    throw new Error(`Convex storage upload failed: ${response.status}`);
  }

  const body = (await response.json()) as { storageId?: Id<"_storage"> };
  if (!body.storageId) {
    throw new Error("Convex storage upload did not return a storageId");
  }

  return {
    storageId: body.storageId,
    byteLength,
  };
};
