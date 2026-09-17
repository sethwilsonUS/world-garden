import { describe, expect, it, vi } from "vitest";

import { viewer } from "./auth";
import { registeredInvoker } from "./testing/registeredFunctions";

const viewerHandler = registeredInvoker(viewer);

describe("auth viewer", () => {
  it("preserves the existing authenticated viewer contract", async () => {
    const identity = {
      email: "ada@example.com",
      issuer: "https://issuer.example",
      name: "Ada Lovelace",
      subject: "user-a",
      tokenIdentifier: "https://issuer.example|user-a",
    };

    await expect(
      viewerHandler(
        {
          auth: {
            getUserIdentity: vi.fn().mockResolvedValue(identity),
          },
        },
        {},
      ),
    ).resolves.toEqual({
      email: "ada@example.com",
      issuer: "https://issuer.example",
      name: "Ada Lovelace",
      subject: "user-a",
      tokenIdentifier: "https://issuer.example|user-a",
    });
  });

  it("normalizes missing optional identity fields", async () => {
    await expect(
      viewerHandler(
        {
          auth: {
            getUserIdentity: vi.fn().mockResolvedValue({
              issuer: "https://issuer.example",
              subject: "user-a",
              tokenIdentifier: "https://issuer.example|user-a",
            }),
          },
        },
        {},
      ),
    ).resolves.toEqual({
      email: null,
      issuer: "https://issuer.example",
      name: null,
      subject: "user-a",
      tokenIdentifier: "https://issuer.example|user-a",
    });
  });

  it("discloses no identity without authentication", async () => {
    await expect(
      viewerHandler(
        {
          auth: {
            getUserIdentity: vi.fn().mockResolvedValue(null),
          },
        },
        {},
      ),
    ).resolves.toBeNull();
  });
});
