import { ON_THIS_DAY_OG_SIZE, renderOnThisDayOgImage } from "./og-card";

export const alt =
  "On This Day — A daily walk through history at Curio Garden";
export const size = ON_THIS_DAY_OG_SIZE;
export const contentType = "image/png";

export default async function OnThisDayOgImage() {
  return await renderOnThisDayOgImage();
}
