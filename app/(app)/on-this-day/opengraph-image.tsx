import {
  EVERGREEN_ON_THIS_DAY_EYEBROW,
  EVERGREEN_ON_THIS_DAY_SUBTITLE,
  loadEvergreenOnThisDayPlates,
} from "@/lib/on-this-day-evergreen-plates";
import {
  ON_THIS_DAY_SHARE_CARD_MIME_TYPE,
  renderOnThisDayShareCardJpeg,
} from "@/lib/on-this-day-share-card";
import { ON_THIS_DAY_OG_SIZE, type OnThisDayOgPlate } from "./og-card";

export const alt =
  "On This Day — A daily walk through history at Curio Garden";
export const size = ON_THIS_DAY_OG_SIZE;
export const contentType = "image/jpeg";

const EVERGREEN_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";

export default async function OnThisDayOgImage(): Promise<Response> {
  const evergreenPlates = await loadEvergreenOnThisDayPlates();
  const orderedPlates = [
    ...evergreenPlates.filter((plate) => plate.isHero),
    ...evergreenPlates.filter((plate) => !plate.isHero),
  ];

  const plates: OnThisDayOgPlate[] = orderedPlates.map((plate) => ({
    imageDataUrl: plate.imageDataUrl,
    alt: plate.title,
    yearLabel: plate.yearLabel,
    isPortrait: plate.isPortrait,
  }));

  const jpegBytes = await renderOnThisDayShareCardJpeg({
    eyebrow: EVERGREEN_ON_THIS_DAY_EYEBROW,
    subtitle: EVERGREEN_ON_THIS_DAY_SUBTITLE,
    plates,
  });

  return new Response(Buffer.from(jpegBytes), {
    headers: {
      "Content-Type": ON_THIS_DAY_SHARE_CARD_MIME_TYPE,
      "Cache-Control": EVERGREEN_CACHE_CONTROL,
    },
  });
}
