import { describe, expect, it, vi } from "vitest";

import { nativeViewer, viewer } from "./auth";

const viewerHandler = (
  viewer as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;
const nativeViewerHandler = (
  nativeViewer as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  }
)._handler;

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

  it("returns only the mobile profile fields from nativeViewer", async () => {
    const identity = {
      email: "ada@example.com",
      issuer: "https://issuer.example",
      name: "Ada Lovelace",
      pictureUrl: "https://private.example/avatar.png",
      subject: "user-a",
      tokenIdentifier: "https://issuer.example|user-a",
    };

    await expect(
      nativeViewerHandler(
        {
          auth: {
            getUserIdentity: vi.fn().mockResolvedValue(identity),
          },
        },
        {},
      ),
    ).resolves.toEqual({
      email: "ada@example.com",
      name: "Ada Lovelace",
      subject: "user-a",
    });
  });

  it.each([
    [
      "viewer",
      viewerHandler,
      {
        email: null,
        issuer: "https://issuer.example",
        name: null,
        subject: "user-a",
        tokenIdentifier: "https://issuer.example|user-a",
      },
    ],
    [
      "nativeViewer",
      nativeViewerHandler,
      {
        email: null,
        name: null,
        subject: "user-a",
      },
    ],
  ] as const)(
    "normalizes missing optional identity fields for %s",
    async (_queryName, handler, expected) => {
      await expect(
        handler(
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
      ).resolves.toEqual(expected);
    },
  );

  it.each([
    ["viewer", viewerHandler],
    ["nativeViewer", nativeViewerHandler],
  ] as const)(
    "discloses no identity when %s is called without authentication",
    async (_queryName, handler) => {
      await expect(
        handler(
          {
            auth: {
              getUserIdentity: vi.fn().mockResolvedValue(null),
            },
          },
          {},
        ),
      ).resolves.toBeNull();
    },
  );
});
