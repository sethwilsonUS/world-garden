import { describe, expect, it } from "vitest";

import {
  getNativeViewerArticleResume,
  writeNativeViewerArticleResume,
} from "./listeningProgress";
import { validatorContractOf } from "./testing/registeredFunctions";

const requiredField = (fieldType: unknown) => ({
  fieldType,
  optional: false,
});

// Convex does not expose these helpers on the public registered-function type.
// These upgrade-sensitive assertions mirror its internal { type, value }
// validator JSON representation so the native transport contract stays exact.
const registeredQuery = validatorContractOf(getNativeViewerArticleResume);
const registeredMutation = validatorContractOf(writeNativeViewerArticleResume);

const modeValidator = {
  type: "union",
  value: [
    { type: "literal", value: "all" },
    { type: "literal", value: "single" },
  ],
};
const clientCursorValidator = {
  type: "object",
  value: {
    wikiPageId: requiredField({ type: "string" }),
    revisionId: requiredField({ type: "string" }),
    narrationVersion: requiredField({ type: "number" }),
    mode: requiredField(modeValidator),
    sectionKey: requiredField({ type: "string" }),
    positionSeconds: requiredField({ type: "number" }),
    durationSeconds: requiredField({ type: "number" }),
  },
};
const serverCursorValidator = {
  type: "object",
  value: {
    ...clientCursorValidator.value,
    cursorVersion: requiredField({ type: "number" }),
    updatedAt: requiredField({ type: "number" }),
  },
};
const responseValidator = {
  type: "object",
  value: {
    sessionEpochKey: requiredField({ type: "string" }),
    cursorVersion: requiredField({ type: "number" }),
    cursor: requiredField({
      type: "union",
      value: [{ type: "null" }, serverCursorValidator],
    }),
  },
};

describe("native listening progress Convex API contract", () => {
  it("binds the exact account-scoped read and compare-and-set transports", () => {
    expect(JSON.parse(registeredQuery.exportArgs())).toEqual({
      type: "object",
      value: {
        expectedAccountSubject: requiredField({ type: "string" }),
        sessionEpochKey: requiredField({ type: "string" }),
        wikiPageId: requiredField({ type: "string" }),
      },
    });
    expect(JSON.parse(registeredQuery.exportReturns())).toEqual(
      responseValidator,
    );

    expect(JSON.parse(registeredMutation.exportArgs())).toEqual({
      type: "object",
      value: {
        expectedAccountSubject: requiredField({ type: "string" }),
        sessionEpochKey: requiredField({ type: "string" }),
        wikiPageId: requiredField({ type: "string" }),
        expectedCursorVersion: requiredField({ type: "number" }),
        cursor: requiredField({
          type: "union",
          value: [{ type: "null" }, clientCursorValidator],
        }),
      },
    });
    expect(JSON.parse(registeredMutation.exportReturns())).toEqual({
      ...responseValidator,
      value: {
        ...responseValidator.value,
        disposition: requiredField({
          type: "union",
          value: [
            { type: "literal", value: "applied" },
            { type: "literal", value: "stale" },
          ],
        }),
      },
    });
  });
});
