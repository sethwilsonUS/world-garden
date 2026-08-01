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
    expect(markup).toContain("min-h-[44px]");
  });

  it("uses input-neutral speed guidance and lets briefing time wrap", () => {
    const markup = renderToStaticMarkup(
      <DailyTrendingBriefPlayer
        audioUrl="/brief.mp3"
        title={longTitle}
        durationSeconds={190}
      />,
    );

    expect(markup).toContain("Activate to change.");
    expect(markup).not.toContain("Click to change.");
    expect(markup).toContain(
      "min-w-0 break-words font-mono text-[0.7rem] text-muted tabular-nums [overflow-wrap:anywhere]",
    );
  });
});
