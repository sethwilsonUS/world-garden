import fs from "node:fs";
import path from "node:path";

const rootLayoutSource = fs.readFileSync(
  path.resolve(__dirname, "../../app/_layout.tsx"),
  "utf8",
);

describe("native playback-rate provider composition", () => {
  it("keeps the device preference above account-scoped providers in the production root", () => {
    const playbackRateOpen = rootLayoutSource.indexOf(
      "<NativePlaybackRateProvider>",
    );
    const dataAuthOpen = rootLayoutSource.indexOf("<NativeDataAuthProvider");
    const navigationShell = rootLayoutSource.indexOf(
      "<NativeNavigationShell />",
    );
    const dataAuthClose = rootLayoutSource.indexOf("</NativeDataAuthProvider>");
    const playbackRateClose = rootLayoutSource.indexOf(
      "</NativePlaybackRateProvider>",
    );

    expect(playbackRateOpen).toBeGreaterThan(-1);
    expect(dataAuthOpen).toBeGreaterThan(playbackRateOpen);
    expect(navigationShell).toBeGreaterThan(dataAuthOpen);
    expect(dataAuthClose).toBeGreaterThan(navigationShell);
    expect(playbackRateClose).toBeGreaterThan(dataAuthClose);
  });
});
