import { isClerkSessionTokenIdentityConsistent } from "./clerkSessionToken";

const HEADER = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9";
const USER_A_PAYLOAD = "eyJzdWIiOiJ1c2VyLWEiLCJzaWQiOiJzZXNzaW9uLWEifQ";
const SIGNATURE = "c2ln";
const USER_A_TOKEN = `${HEADER}.${USER_A_PAYLOAD}.${SIGNATURE}`;
const tokenWith = ({
  header = HEADER,
  payload = USER_A_PAYLOAD,
  signature = SIGNATURE,
}: {
  header?: string;
  payload?: string;
  signature?: string;
} = {}): string => `${header}.${payload}.${signature}`;

describe("isClerkSessionTokenIdentityConsistent", () => {
  it("accepts a structurally valid token for the exact expected Clerk user and session", () => {
    expect(
      isClerkSessionTokenIdentityConsistent(
        USER_A_TOKEN,
        "user-a",
        "session-a",
      ),
    ).toBe(true);
  });

  it("accepts Unicode Clerk identifiers and an opaque binary signature", () => {
    const unicodePayload = "eyJzdWIiOiLnlKjmiLciLCJzaWQiOiLkvJror50ifQ";

    expect(
      isClerkSessionTokenIdentityConsistent(
        tokenWith({ payload: unicodePayload, signature: "_w" }),
        "用户",
        "会话",
      ),
    ).toBe(true);
  });

  it.each([
    ["a missing signature", `${HEADER}.${USER_A_PAYLOAD}`],
    ["an extra segment", `${USER_A_TOKEN}.extra`],
    ["an empty header", `.${USER_A_PAYLOAD}.${SIGNATURE}`],
    ["an empty payload", `${HEADER}..${SIGNATURE}`],
    ["an empty signature", `${HEADER}.${USER_A_PAYLOAD}.`],
  ])("rejects %s", (_description, token) => {
    expect(
      isClerkSessionTokenIdentityConsistent(token, "user-a", "session-a"),
    ).toBe(false);
  });

  it.each([
    ["standard base64 padding", tokenWith({ signature: "c2ln=" })],
    ["the standard base64 plus character", tokenWith({ signature: "+w" })],
    ["the standard base64 slash character", tokenWith({ signature: "/w" })],
    ["whitespace", tokenWith({ signature: "c2 ln" })],
    ["a length-one header", tokenWith({ header: "A" })],
    ["a length-one payload", tokenWith({ payload: "A" })],
    ["a length-one signature", tokenWith({ signature: "A" })],
  ])("rejects a segment containing %s", (_description, token) => {
    expect(
      isClerkSessionTokenIdentityConsistent(token, "user-a", "session-a"),
    ).toBe(false);
  });

  it.each([
    ["header", tokenWith({ header: "e31" })],
    [
      "payload",
      tokenWith({
        payload: "eyJzdWIiOiJ1c2VyLWEiLCJzaWQiOiJzZXNzaW9uLWEifR",
      }),
    ],
    ["signature", tokenWith({ signature: "YWJ" })],
  ])("rejects noncanonical base64url pad bits in the %s", (_part, token) => {
    expect(
      isClerkSessionTokenIdentityConsistent(token, "user-a", "session-a"),
    ).toBe(false);
  });

  it.each([
    ["invalid UTF-8", "wyg"],
    ["invalid JSON", "bm90LWpzb24"],
    ["JSON null", "bnVsbA"],
    ["a JSON array", "W10"],
    ["a JSON primitive", "Im5vdC1vYmplY3Qi"],
  ])("rejects a header containing %s", (_description, header) => {
    expect(
      isClerkSessionTokenIdentityConsistent(
        tokenWith({ header }),
        "user-a",
        "session-a",
      ),
    ).toBe(false);
  });

  it.each([
    ["invalid UTF-8", "wyg"],
    ["invalid JSON", "bm90LWpzb24"],
    ["JSON null", "bnVsbA"],
    ["a JSON array", "W10"],
    ["a JSON primitive", "Im5vdC1vYmplY3Qi"],
    ["a missing sub", "eyJzaWQiOiJzZXNzaW9uLWEifQ"],
    ["a missing sid", "eyJzdWIiOiJ1c2VyLWEifQ"],
    ["a non-string sub", "eyJzdWIiOjcsInNpZCI6InNlc3Npb24tYSJ9"],
    ["a non-string sid", "eyJzdWIiOiJ1c2VyLWEiLCJzaWQiOjd9"],
  ])("rejects a payload containing %s", (_description, payload) => {
    expect(
      isClerkSessionTokenIdentityConsistent(
        tokenWith({ payload }),
        "user-a",
        "session-a",
      ),
    ).toBe(false);
  });

  it.each([
    ["another user", "eyJzdWIiOiJ1c2VyLWIiLCJzaWQiOiJzZXNzaW9uLWEifQ"],
    ["another session", "eyJzdWIiOiJ1c2VyLWEiLCJzaWQiOiJzZXNzaW9uLWIifQ"],
  ])("rejects an otherwise valid token for %s", (_description, payload) => {
    expect(
      isClerkSessionTokenIdentityConsistent(
        tokenWith({ payload }),
        "user-a",
        "session-a",
      ),
    ).toBe(false);
  });

  it("enforces the 8,192-character limit before decoding", () => {
    const fixedLength = HEADER.length + USER_A_PAYLOAD.length + 2;
    const atLimit = tokenWith({
      signature: "A".repeat(8_192 - fixedLength),
    });
    const overLimit = tokenWith({
      signature: "A".repeat(8_196 - fixedLength),
    });

    expect(atLimit).toHaveLength(8_192);
    expect(
      isClerkSessionTokenIdentityConsistent(atLimit, "user-a", "session-a"),
    ).toBe(true);
    expect(overLimit).toHaveLength(8_196);
    expect(
      isClerkSessionTokenIdentityConsistent(overLimit, "user-a", "session-a"),
    ).toBe(false);
  });

  it.each([
    [undefined, "user-a", "session-a"],
    [null, "user-a", "session-a"],
    [{}, "user-a", "session-a"],
    [USER_A_TOKEN, undefined, "session-a"],
    [USER_A_TOKEN, "user-a", undefined],
    [USER_A_TOKEN, "", "session-a"],
    [USER_A_TOKEN, "user-a", ""],
  ])("is total and rejects invalid inputs", (token, userId, sessionId) => {
    expect(() =>
      isClerkSessionTokenIdentityConsistent(token, userId, sessionId),
    ).not.toThrow();
    expect(
      isClerkSessionTokenIdentityConsistent(token, userId, sessionId),
    ).toBe(false);
  });

  it("does not log token data when rejecting malformed input", () => {
    const error = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      expect(
        isClerkSessionTokenIdentityConsistent(
          `${USER_A_TOKEN}.secret-token-material`,
          "user-a",
          "session-a",
        ),
      ).toBe(false);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });
});
