import { action } from "./_generated/server";
import { v } from "convex/values";
import {
  searchWikipedia,
  searchWikipediaWithMeta,
  suggestWikipediaTitles,
} from "./lib/wikipedia";

const MAX_SEARCH_TERM_LENGTH = 300;

export const search = action({
  args: { term: v.string() },
  async handler(_ctx, args) {
    const normalized = args.term.trim();
    if (!normalized) {
      return [];
    }
    return await searchWikipedia(normalized.slice(0, MAX_SEARCH_TERM_LENGTH));
  },
});

export const searchWithMeta = action({
  args: { term: v.string() },
  async handler(_ctx, args) {
    const normalized = args.term.trim();
    if (!normalized) {
      return { results: [] };
    }
    return await searchWikipediaWithMeta(
      normalized.slice(0, MAX_SEARCH_TERM_LENGTH),
    );
  },
});

export const suggestTitles = action({
  args: { term: v.string() },
  async handler(_ctx, args) {
    const normalized = args.term.trim();
    if (!normalized) {
      return [];
    }
    return await suggestWikipediaTitles(
      normalized.slice(0, MAX_SEARCH_TERM_LENGTH),
    );
  },
});
