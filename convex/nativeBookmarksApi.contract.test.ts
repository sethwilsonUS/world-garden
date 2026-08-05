import { describe, expect, it } from "vitest";

import {
  listNativeViewerBookmarks,
  removeNativeViewerBookmark,
  saveNativeViewerBookmark,
} from "./bookmarks";

const requiredField = (fieldType: unknown) => ({
  fieldType,
  optional: false,
});
const registeredQuery = listNativeViewerBookmarks as unknown as {
  exportArgs(): string;
  exportReturns(): string;
};
const registeredSaveMutation = saveNativeViewerBookmark as unknown as {
  exportArgs(): string;
  exportReturns(): string;
};
const registeredRemoveMutation = removeNativeViewerBookmark as unknown as {
  exportArgs(): string;
  exportReturns(): string;
};
const bookmarkEntry = {
  type: "object",
  value: {
    slug: requiredField({ type: "string" }),
    title: requiredField({ type: "string" }),
    savedAt: requiredField({ type: "number" }),
  },
};

describe("native bookmarks Convex API contract", () => {
  it("binds native list transport to the validated account subject and epoch", () => {
    expect(JSON.parse(registeredQuery.exportArgs())).toEqual({
      type: "object",
      value: {
        expectedAccountSubject: requiredField({ type: "string" }),
        sessionEpochKey: requiredField({ type: "string" }),
      },
    });
    expect(JSON.parse(registeredQuery.exportReturns())).toEqual({
      type: "object",
      value: {
        sessionEpochKey: requiredField({ type: "string" }),
        entries: requiredField({
          type: "array",
          value: bookmarkEntry,
        }),
      },
    });
  });

  it("binds native save and remove transport to the validated account subject and epoch", () => {
    expect(JSON.parse(registeredSaveMutation.exportArgs())).toEqual({
      type: "object",
      value: {
        expectedAccountSubject: requiredField({ type: "string" }),
        sessionEpochKey: requiredField({ type: "string" }),
        slug: requiredField({ type: "string" }),
        title: requiredField({ type: "string" }),
      },
    });
    expect(JSON.parse(registeredSaveMutation.exportReturns())).toEqual({
      type: "object",
      value: {
        entry: requiredField(bookmarkEntry),
        sessionEpochKey: requiredField({ type: "string" }),
      },
    });
    expect(JSON.parse(registeredRemoveMutation.exportArgs())).toEqual({
      type: "object",
      value: {
        expectedAccountSubject: requiredField({ type: "string" }),
        sessionEpochKey: requiredField({ type: "string" }),
        slug: requiredField({ type: "string" }),
      },
    });
    expect(JSON.parse(registeredRemoveMutation.exportReturns())).toEqual({
      type: "object",
      value: {
        removed: requiredField({ type: "boolean" }),
        sessionEpochKey: requiredField({ type: "string" }),
      },
    });
  });
});
