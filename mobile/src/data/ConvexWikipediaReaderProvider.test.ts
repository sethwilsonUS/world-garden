import type {
  WikipediaArticle,
  WikipediaSearchResult,
} from "@curio-garden/domain";

import { createWikipediaReader } from "./ConvexWikipediaReaderProvider";

describe("createWikipediaReader", () => {
  it("delegates only the public search and article arguments", async () => {
    const results: WikipediaSearchResult[] = [
      {
        wikiPageId: "736",
        title: "Ada Lovelace",
        description: "English mathematician",
        url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
      },
    ];
    const article: WikipediaArticle = {
      wikiPageId: "736",
      revisionId: "1234",
      title: "Ada Lovelace",
      language: "en",
      narrationVersion: 2,
      sections: [],
    };
    const searchAction = jest.fn().mockResolvedValue(results);
    const fetchArticleAction = jest.fn().mockResolvedValue(article);
    const reader = createWikipediaReader({
      fetchArticleAction,
      searchAction,
    });

    await expect(reader.search({ term: "Ada" })).resolves.toBe(results);
    await expect(reader.fetchArticle({ slug: "Ada_Lovelace" })).resolves.toBe(
      article,
    );
    expect(searchAction).toHaveBeenCalledWith({ term: "Ada" });
    expect(fetchArticleAction).toHaveBeenCalledWith({
      slug: "Ada_Lovelace",
    });
  });
});
