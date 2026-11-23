import { ImageResponse } from "next/og";
import { loadOgFonts } from "@/app/og-fonts";

export const ON_THIS_DAY_OG_SIZE = { width: 1200, height: 630 } as const;

export type OnThisDayOgPlate = {
  imageDataUrl: string;
  alt: string;
  yearLabel?: string;
  isPortrait?: boolean;
};

export type RenderOnThisDayOgImageOptions = {
  dayLabel?: string;
  eyebrow?: string;
  subtitle?: string;
  plates?: readonly OnThisDayOgPlate[];
};

type PlateSlot = {
  plateIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  rotateDeg: number;
  pillCorner: "bottom-left" | "bottom-right";
};

const colors = {
  garden: "#07523f",
  gardenDeep: "#043d30",
  paper: "#f3ecdd",
  matte: "#f7f2e7",
  photoBackdrop: "#102d24",
  ink: "#17483a",
  mutedInk: "#66786f",
  galleryMutedInk: "#52645b",
  gold: "#b88a48",
  goldSoft: "#d7bd8d",
} as const;

const GALLERY_LEFT_COLUMN_WIDTH = 494;
const GALLERY_MAT_WIDTH = 618;
const PLATE_MATTE_PADDING = 7;

function LeafIcon({ size: iconSize }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="none"
      width={iconSize}
      height={iconSize}
    >
      <g
        stroke={colors.garden}
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M256 80C172 136 144 196 144 248c0 56 56 96 112 112 56-16 112-56 112-112 0-52-28-112-112-168z" />
        <path d="M256 80v320" />
        <path d="M256 160l-48 48" />
        <path d="M256 160l48 48" />
        <path d="M256 240l-64 48" />
        <path d="M256 240l64 48" />
      </g>
    </svg>
  );
}

function PaperTexture({ width = 790 }: { width?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height="540"
      viewBox={`0 0 ${width} 540`}
      style={{ position: "absolute", left: 0, top: 0 }}
    >
      <path
        d="M-60 480C90 390 145 420 250 345S440 300 520 205 665 120 850 70"
        fill="none"
        stroke={colors.gold}
        strokeWidth="2"
        opacity="0.1"
      />
      <path
        d="M-80 520C85 415 170 475 275 380S465 335 550 240 700 155 870 105"
        fill="none"
        stroke={colors.gold}
        strokeWidth="1"
        opacity="0.08"
      />
      <circle
        cx={width === 790 ? 670 : 378}
        cy="116"
        r="98"
        fill="none"
        stroke={colors.ink}
        strokeWidth="1"
        opacity="0.05"
      />
      <circle
        cx={width === 790 ? 670 : 378}
        cy="116"
        r="72"
        fill="none"
        stroke={colors.ink}
        strokeWidth="1"
        opacity="0.05"
      />
    </svg>
  );
}

const timelineStops = [
  { year: "500", top: 170 },
  { year: "1000", top: 250 },
  { year: "1500", top: 330 },
  { year: "2000", top: 410 },
];

function TimelinePanel() {
  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        width: "322px",
        height: "540px",
        display: "flex",
        flexDirection: "column",
        color: colors.paper,
        backgroundColor: colors.gardenDeep,
        overflow: "hidden",
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="322"
        height="540"
        viewBox="0 0 322 540"
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <circle
          cx="300"
          cy="34"
          r="135"
          fill="none"
          stroke={colors.paper}
          strokeWidth="1"
          opacity="0.08"
        />
        <circle
          cx="300"
          cy="34"
          r="96"
          fill="none"
          stroke={colors.paper}
          strokeWidth="1"
          opacity="0.08"
        />
        <path
          d="M258 540C206 470 232 405 282 355C323 314 333 259 312 210"
          fill="none"
          stroke={colors.goldSoft}
          strokeWidth="2"
          opacity="0.16"
        />
      </svg>

      <div
        style={{
          position: "absolute",
          left: "54px",
          top: "50px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            fontFamily: "DM Sans, sans-serif",
            fontSize: "13px",
            color: colors.goldSoft,
            letterSpacing: "0.2em",
          }}
        >
          ACROSS THE
        </div>
        <div
          style={{
            marginTop: "3px",
            fontFamily: "Fraunces, serif",
            fontSize: "28px",
            fontWeight: 700,
          }}
        >
          Centuries
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: "72px",
          top: "151px",
          width: "2px",
          height: "303px",
          display: "flex",
          backgroundColor: colors.gold,
          opacity: 0.72,
        }}
      />

      {timelineStops.map(({ year, top }) => (
        <div
          key={year}
          style={{
            position: "absolute",
            left: "64px",
            top: `${top}px`,
            display: "flex",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: "18px",
              height: "18px",
              display: "flex",
              border: `2px solid ${colors.goldSoft}`,
              borderRadius: "50%",
              backgroundColor: colors.gardenDeep,
            }}
          />
          <div
            style={{
              marginLeft: "23px",
              fontFamily: "DM Sans, sans-serif",
              fontSize: "21px",
              color: colors.paper,
              letterSpacing: "0.08em",
            }}
          >
            {year}
          </div>
        </div>
      ))}

      <div
        style={{
          position: "absolute",
          left: "54px",
          bottom: "32px",
          display: "flex",
          alignItems: "center",
          fontFamily: "DM Sans, sans-serif",
          fontSize: "12px",
          color: colors.goldSoft,
          letterSpacing: "0.17em",
        }}
      >
        THEN · NOW · ALWAYS
      </div>
    </div>
  );
}

function GalleryMatPanel() {
  return (
    <div
      style={{
        position: "absolute",
        left: `${GALLERY_LEFT_COLUMN_WIDTH}px`,
        top: 0,
        width: `${GALLERY_MAT_WIDTH}px`,
        height: "540px",
        display: "flex",
        backgroundColor: colors.gardenDeep,
        borderLeft: "1px solid rgba(215, 189, 141, 0.24)",
        overflow: "hidden",
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={GALLERY_MAT_WIDTH}
        height="540"
        viewBox={`0 0 ${GALLERY_MAT_WIDTH} 540`}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <circle
          cx="548"
          cy="56"
          r="210"
          fill="none"
          stroke={colors.paper}
          strokeWidth="1"
          opacity="0.08"
        />
        <circle
          cx="548"
          cy="56"
          r="148"
          fill="none"
          stroke={colors.paper}
          strokeWidth="1"
          opacity="0.08"
        />
        <circle
          cx="86"
          cy="486"
          r="190"
          fill="none"
          stroke={colors.goldSoft}
          strokeWidth="1"
          opacity="0.1"
        />
        <circle
          cx="316"
          cy="268"
          r="188"
          fill="none"
          stroke={colors.paper}
          strokeWidth="1"
          opacity="0.06"
        />
        <path
          d="M-12 110C120 74 226 112 318 196C414 284 510 318 636 270"
          fill="none"
          stroke={colors.goldSoft}
          strokeWidth="1.5"
          opacity="0.15"
        />
        <path
          d="M18 476C146 410 250 402 356 446C456 488 548 482 640 426"
          fill="none"
          stroke={colors.goldSoft}
          strokeWidth="1"
          opacity="0.12"
        />
        <line
          x1="316"
          y1="62"
          x2="316"
          y2="478"
          stroke={colors.paper}
          strokeWidth="1"
          opacity="0.05"
        />
        <line
          x1="46"
          y1="268"
          x2="586"
          y2="268"
          stroke={colors.paper}
          strokeWidth="1"
          opacity="0.05"
        />
      </svg>
    </div>
  );
}

/**
 * Returns Satori-safe absolute slots ordered back-to-front in DOM order.
 * Slot `plateIndex: 0` (Hero) is always last so it sits on top.
 */
function getGalleryPlateSlots(
  plates: readonly OnThisDayOgPlate[],
): readonly PlateSlot[] {
  switch (plates.length) {
    case 1:
      if (plates[0]?.isPortrait) {
        return [
          {
            plateIndex: 0,
            left: 606,
            top: 40,
            width: 394,
            height: 460,
            rotateDeg: -1.4,
            pillCorner: "bottom-left",
          },
        ];
      }
      return [
        {
          plateIndex: 0,
          left: 528,
          top: 66,
          width: 550,
          height: 408,
          rotateDeg: -1.4,
          pillCorner: "bottom-left",
        },
      ];

    case 2:
      return [
        {
          plateIndex: 1,
          left: 742,
          top: 212,
          width: 336,
          height: 288,
          rotateDeg: 2.2,
          pillCorner: "bottom-right",
        },
        {
          plateIndex: 0,
          left: 470,
          top: 46,
          width: 344,
          height: 294,
          rotateDeg: -2.2,
          pillCorner: "bottom-left",
        },
      ];

    case 3:
      return [
        {
          plateIndex: 1,
          left: 778,
          top: 26,
          width: 304,
          height: 222,
          rotateDeg: 2.1,
          pillCorner: "bottom-right",
        },
        {
          plateIndex: 2,
          left: 786,
          top: 258,
          width: 274,
          height: 256,
          rotateDeg: -1.8,
          pillCorner: "bottom-right",
        },
        {
          plateIndex: 0,
          left: 470,
          top: 128,
          width: 316,
          height: 284,
          rotateDeg: -2.4,
          pillCorner: "bottom-left",
        },
      ];

    case 4:
      return [
        {
          plateIndex: 3,
          left: 590,
          top: 322,
          width: 232,
          height: 194,
          rotateDeg: 1.6,
          pillCorner: "bottom-left",
        },
        {
          plateIndex: 1,
          left: 800,
          top: 24,
          width: 284,
          height: 218,
          rotateDeg: 2.1,
          pillCorner: "bottom-right",
        },
        {
          plateIndex: 2,
          left: 838,
          top: 256,
          width: 246,
          height: 260,
          rotateDeg: -1.8,
          pillCorner: "bottom-right",
        },
        {
          plateIndex: 0,
          left: 470,
          top: 102,
          width: 304,
          height: 244,
          rotateDeg: -2.3,
          pillCorner: "bottom-left",
        },
      ];

    default:
      return [
        {
          plateIndex: 3,
          left: 642,
          top: 16,
          width: 208,
          height: 166,
          rotateDeg: 2.6,
          pillCorner: "bottom-right",
        },
        {
          plateIndex: 1,
          left: 860,
          top: 22,
          width: 230,
          height: 192,
          rotateDeg: 2.0,
          pillCorner: "bottom-right",
        },
        {
          plateIndex: 4,
          left: 628,
          top: 344,
          width: 206,
          height: 182,
          rotateDeg: 1.4,
          pillCorner: "bottom-left",
        },
        {
          plateIndex: 2,
          left: 848,
          top: 238,
          width: 238,
          height: 278,
          rotateDeg: -1.8,
          pillCorner: "bottom-right",
        },
        {
          plateIndex: 0,
          left: 468,
          top: 116,
          width: 268,
          height: 228,
          rotateDeg: -2.3,
          pillCorner: "bottom-left",
        },
      ];
  }
}

function getGalleryHeadlineFontSize(headline: string): string {
  if (headline.length >= 12) return "62px";
  if (headline.length >= 11) return "64px";
  if (headline.length >= 9) return "72px";
  if (headline.length >= 7) return "78px";
  return "84px";
}

function formatGallerySubtitleLines(subtitle: string): readonly string[] {
  const boundNumbers = subtitle.replace(/(\d[\d,]*)\s+([A-Za-z]+)/gu, "$1\u00A0$2");
  const dotParts = boundNumbers
    .split(/\s+·\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (dotParts.length === 4) {
    return [
      `${dotParts[0]} · ${dotParts[1]}`,
      `${dotParts[2]} · ${dotParts[3]}`,
    ];
  }

  return [boundNumbers.replace(/\s+(\S+)\s*$/u, "\u00A0$1")];
}

function ArchivalPlate({
  plate,
  slot,
}: {
  plate: OnThisDayOgPlate;
  slot: PlateSlot;
}) {
  const yearLabel = plate.yearLabel?.trim();
  const imageWidth = slot.width - PLATE_MATTE_PADDING * 2;
  const imageHeight = slot.height - PLATE_MATTE_PADDING * 2;
  const pillStyle =
    slot.pillCorner === "bottom-left"
      ? { left: "8px" as const }
      : { right: "8px" as const };

  return (
    <div
      style={{
        position: "absolute",
        left: `${slot.left}px`,
        top: `${slot.top}px`,
        width: `${slot.width}px`,
        height: `${slot.height}px`,
        padding: `${PLATE_MATTE_PADDING}px`,
        display: "flex",
        backgroundColor: colors.matte,
        borderRadius: "6px",
        boxShadow: "0 14px 30px rgba(2, 24, 18, 0.42)",
        transform: `rotate(${slot.rotateDeg}deg)`,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          overflow: "hidden",
          borderRadius: "2px",
          backgroundColor: colors.photoBackdrop,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={plate.imageDataUrl}
          alt={plate.alt}
          width={imageWidth}
          height={imageHeight}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: plate.isPortrait ? "50% 14%" : "50% 16%",
          }}
        />
        {yearLabel ? (
          <div
            style={{
              position: "absolute",
              bottom: "8px",
              ...pillStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px 10px",
              borderRadius: "4px",
              backgroundColor: colors.gardenDeep,
              border: `1.5px solid ${colors.goldSoft}`,
              color: colors.paper,
              fontFamily: "DM Sans, sans-serif",
              fontSize: "18px",
              fontWeight: 700,
              lineHeight: 1.15,
              letterSpacing: "0.04em",
              boxShadow: "0 4px 10px rgba(2, 24, 18, 0.48)",
            }}
          >
            {yearLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export async function renderOnThisDayOgImage({
  dayLabel,
  eyebrow: customEyebrow,
  subtitle: customSubtitle,
  plates,
}: RenderOnThisDayOgImageOptions = {}): Promise<ImageResponse> {
  const fonts = await loadOgFonts();
  const activePlates = (plates ?? [])
    .filter((plate) => plate.imageDataUrl.trim().length > 0)
    .slice(0, 5);
  const hasGalleryPlates = activePlates.length > 0;

  const eyebrow =
    customEyebrow?.trim() ||
    (dayLabel ? "ON THIS DAY" : "A DAILY WALK THROUGH HISTORY");
  const headline = dayLabel ?? "On This Day";
  const defaultSubtitle = dayLabel
    ? `Explore the events, notable lives, and holidays from ${dayLabel} across the centuries.`
    : hasGalleryPlates
      ? "History's defining moments, notable lives, and holidays — every day of the year."
      : "Discover the events, notable lives, and holidays that shaped today.";
  const subtitle = customSubtitle?.trim() || defaultSubtitle;

  if (!hasGalleryPlates) {
    const headlineFontSize =
      headline.length > 13 ? "74px" : headline.length > 10 ? "82px" : "90px";

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.garden,
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "24px",
              display: "flex",
              border: "1px solid rgba(243, 236, 221, 0.24)",
            }}
          />

          <div
            style={{
              position: "relative",
              width: "1112px",
              height: "540px",
              display: "flex",
              backgroundColor: colors.paper,
              boxShadow: "0 18px 42px rgba(3, 44, 33, 0.28)",
              overflow: "hidden",
            }}
          >
            <PaperTexture />

            <div
              style={{
                position: "absolute",
                left: "50px",
                top: "42px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <LeafIcon size={42} />
              <div
                style={{
                  marginLeft: "12px",
                  fontFamily: "Fraunces, serif",
                  fontSize: "27px",
                  fontWeight: 700,
                  color: colors.ink,
                }}
              >
                Curio Garden
              </div>
            </div>

            <div
              style={{
                position: "absolute",
                left: "54px",
                top: "148px",
                display: "flex",
                flexDirection: "column",
                width: "690px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  fontSize: "15px",
                  color: colors.gold,
                  letterSpacing: "0.21em",
                }}
              >
                {eyebrow}
              </div>
              <div
                style={{
                  marginTop: "13px",
                  display: "flex",
                  fontFamily: "Fraunces, serif",
                  fontSize: headlineFontSize,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: colors.ink,
                  letterSpacing: "-0.035em",
                }}
              >
                {headline}
              </div>
              <div
                style={{
                  width: "92px",
                  height: "3px",
                  marginTop: "26px",
                  display: "flex",
                  backgroundColor: colors.gold,
                }}
              />
              <div
                style={{
                  marginTop: "22px",
                  display: "flex",
                  maxWidth: "610px",
                  fontSize: "24px",
                  lineHeight: 1.42,
                  color: colors.mutedInk,
                }}
              >
                {subtitle}
              </div>
            </div>

            <div
              style={{
                position: "absolute",
                left: "54px",
                bottom: "36px",
                display: "flex",
                alignItems: "center",
                fontSize: "13px",
                color: colors.ink,
                letterSpacing: "0.16em",
              }}
            >
              EVENTS
              <span style={{ margin: "0 15px", color: colors.gold }}>•</span>
              NOTABLE LIVES
              <span style={{ margin: "0 15px", color: colors.gold }}>•</span>
              HOLIDAYS
            </div>

            <TimelinePanel />
          </div>
        </div>
      ),
      {
        ...ON_THIS_DAY_OG_SIZE,
        fonts,
      },
    );
  }

  const slots = getGalleryPlateSlots(activePlates);
  const headlineFontSize = getGalleryHeadlineFontSize(headline);
  const subtitleLines = formatGallerySubtitleLines(subtitle);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.garden,
          fontFamily: "DM Sans, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "24px",
            display: "flex",
            border: "1px solid rgba(243, 236, 221, 0.24)",
          }}
        />

        <div
          style={{
            position: "relative",
            width: "1112px",
            height: "540px",
            display: "flex",
            backgroundColor: colors.paper,
            boxShadow: "0 18px 42px rgba(3, 44, 33, 0.28)",
            overflow: "hidden",
          }}
        >
          <PaperTexture width={GALLERY_LEFT_COLUMN_WIDTH} />
          <GalleryMatPanel />

          <div
            style={{
              position: "absolute",
              left: "36px",
              top: "38px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <LeafIcon size={40} />
            <div
              style={{
                marginLeft: "11px",
                fontFamily: "Fraunces, serif",
                fontSize: "26px",
                fontWeight: 700,
                color: colors.ink,
              }}
            >
              Curio Garden
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: "36px",
              top: "148px",
              display: "flex",
              flexDirection: "column",
              width: "422px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: "14px",
                color: colors.gold,
                letterSpacing: "0.21em",
              }}
            >
              {eyebrow}
            </div>
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                fontFamily: "Fraunces, serif",
                fontSize: headlineFontSize,
                fontWeight: 700,
                lineHeight: 1.04,
                color: colors.ink,
                letterSpacing: "-0.04em",
              }}
            >
              {headline}
            </div>
            <div
              style={{
                width: "84px",
                height: "3px",
                marginTop: "22px",
                display: "flex",
                backgroundColor: colors.gold,
              }}
            />
            <div
              style={{
                marginTop: "20px",
                display: "flex",
                flexDirection: "column",
                maxWidth: "408px",
                fontSize: "21px",
                lineHeight: 1.44,
                color: colors.galleryMutedInk,
              }}
            >
              {subtitleLines.map((line) => (
                <div key={line} style={{ display: "flex" }}>
                  {line}
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: "36px",
              bottom: "34px",
              display: "flex",
              alignItems: "center",
              fontSize: "12px",
              color: colors.ink,
              letterSpacing: "0.16em",
            }}
          >
            EVENTS
            <span style={{ margin: "0 12px", color: colors.gold }}>•</span>
            NOTABLE LIVES
            <span style={{ margin: "0 12px", color: colors.gold }}>•</span>
            HOLIDAYS
          </div>

          {slots.map((slot) => {
            const plate = activePlates[slot.plateIndex];
            if (!plate) return null;
            return (
              <ArchivalPlate
                key={`${slot.plateIndex}-${plate.alt}`}
                plate={plate}
                slot={slot}
              />
            );
          })}
        </div>
      </div>
    ),
    {
      ...ON_THIS_DAY_OG_SIZE,
      fonts,
    },
  );
}
