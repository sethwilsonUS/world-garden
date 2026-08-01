import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArticleAudioExportTray, type TrayJob } from "./ArticleAudioExportTray";

const job = (id: string): TrayJob => ({
  _id: id,
  title: `A deliberately long article title for download ${id}`,
  status: "running",
  stage: "rendering_audio",
  sectionCount: 12,
  completedSectionCount: 4,
  createdAt: 1,
  updatedAt: 1,
  kind: "export",
});

describe("ArticleAudioExportTray", () => {
  it("keeps multiple long download notices in a bounded scrollable region", () => {
    const markup = renderToStaticMarkup(
      <ArticleAudioExportTray
        jobs={[job("one"), job("two"), job("three"), job("four")]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        politeAnnouncement="Downloads are progressing."
        assertiveAnnouncement=""
      />,
    );

    expect(markup).toContain('aria-label="Audio downloads"');
    expect(markup).toContain(
      "max-h-[calc(100dvh_-_32px_-_env(safe-area-inset-bottom))]",
    );
    expect(markup).toContain("overflow-y-auto");
    expect(markup.match(/Dismiss audio download status/g)).toHaveLength(4);
    expect(markup).not.toContain("truncate");
  });
});
