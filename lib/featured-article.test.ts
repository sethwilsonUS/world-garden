import { describe, expect, it } from "vitest";
import { parseDidYouKnowItem } from "./featured-article";

describe("parseDidYouKnowItem", () => {
  it("converts Wikipedia article links into internal slug segments", () => {
    const item = parseDidYouKnowItem({
      html:
        '... that, by establishing diplomatic missions like <b><a href="https://en.wikipedia.org/wiki/Embassy_of_the_Philippines,_Suva">an embassy in Fiji</a></b>, the Philippine government hopes to play a bigger role in international politics?',
      text:
        "... that, by establishing diplomatic missions like an embassy in Fiji, the Philippine government hopes to play a bigger role in international politics?",
    });

    expect(item).toEqual({
      text:
        "... that, by establishing diplomatic missions like an embassy in Fiji, the Philippine government hopes to play a bigger role in international politics?",
      links: [
        {
          title: "Embassy of the Philippines, Suva",
          slug: "Embassy_of_the_Philippines,_Suva",
          text: "an embassy in Fiji",
        },
      ],
      segments: [
        {
          type: "text",
          text: "... that, by establishing diplomatic missions like ",
        },
        {
          type: "link",
          text: "an embassy in Fiji",
          title: "Embassy of the Philippines, Suva",
          slug: "Embassy_of_the_Philippines,_Suva",
        },
        {
          type: "text",
          text: ", the Philippine government hopes to play a bigger role in international politics?",
        },
      ],
    });
  });

  it("treats blocked namespaces as plain text instead of internal links", () => {
    const item = parseDidYouKnowItem({
      html:
        '... that <a href="https://en.wikipedia.org/wiki/Template:Foo">this template reference</a> should not become an article link?',
      text:
        "... that this template reference should not become an article link?",
    });

    expect(item?.links).toEqual([]);
    expect(item?.segments).toEqual([
      {
        type: "text",
        text: "... that this template reference should not become an article link?",
      },
    ]);
  });

  it("falls back to plain text when no HTML is provided", () => {
    const item = parseDidYouKnowItem({
      text: "... that Curio Garden now has a trivia page?",
    });

    expect(item).toEqual({
      text: "... that Curio Garden now has a trivia page?",
      links: [],
      segments: [
        {
          type: "text",
          text: "... that Curio Garden now has a trivia page?",
        },
      ],
    });
  });
});
