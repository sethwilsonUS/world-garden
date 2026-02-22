import { action } from "./_generated/server";
import { v } from "convex/values";
import { searchWikipedia } from "./lib/wikipedia";

export const search = action({
  args: { term: v.string() },
  async handler(_ctx, args) {
    if (!args.term.trim()) {
      return [];
    }
    return await searchWikipedia(args.term.trim());
  },
});
