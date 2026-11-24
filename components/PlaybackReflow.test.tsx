import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DailyTrendingBriefPlayer } from "./DailyTrendingBriefPlayer";
import { PodcastEpisodePlayer } from "./PodcastEpisodePlayer";

const longTitle =
  "An exceptionally detailed episode title that needs several lines at enlarged text sizes";

describe("compact playback reflow", () => {
  it.each([
    [
      "podcast episode",
      <PodcastEpisodePlayer
        key="podcast"
        audioUrl="/episode.mp3"
        title={longTitle}
        durationSeconds={190}
      />,
    ],
    [
      "daily briefing",
      <DailyTrendingBriefPlayer
        key="brief"
        audioUrl="/brief.mp3"
        title={longTitle}
        durationSeconds={190}
      />,
    ],
  ])("keeps the full %s title and 44px controls", (_name, player) => {
    const markup = renderToStaticMarkup(player);

    expect(markup).toContain(longTitle);
    expect(markup).not.toContain("truncate");
    // 44px play button and 44px speed buttons.
    expect(markup).toContain("h-[44px] w-[44px]");
    expect(markup).toContain("min-h-11 min-w-11");
  });

  it("names speed buttons by action and lets briefing time wrap", () => {
    const markup = renderToStaticMarkup(
      <DailyTrendingBriefPlayer
        audioUrl="/brief.mp3"
        title={longTitle}
        durationSeconds={190}
      />,
    );

    expect(markup).toContain('aria-label="Slower"');
    expect(markup).toContain('aria-label="Faster"');
    expect(markup).not.toContain("Click to change.");
    expect(markup).toContain(
      "min-w-0 break-words font-mono text-xs text-muted tabular-nums [overflow-wrap:anywhere]",
    );
  });
});
