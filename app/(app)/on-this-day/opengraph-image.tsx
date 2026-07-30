import { ImageResponse } from "next/og";
import { loadOgFonts } from "@/app/og-fonts";

export const alt =
  "On This Day — A daily walk through history at Curio Garden";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const colors = {
  garden: "#07523f",
  gardenDeep: "#043d30",
  paper: "#f3ecdd",
  ink: "#17483a",
  mutedInk: "#66786f",
  gold: "#b88a48",
  goldSoft: "#d7bd8d",
};

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

function PaperTexture() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="790"
      height="540"
      viewBox="0 0 790 540"
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
        cx="670"
        cy="120"
        r="98"
        fill="none"
        stroke={colors.ink}
        strokeWidth="1"
        opacity="0.05"
      />
      <circle
        cx="670"
        cy="120"
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

export default async function OnThisDayOgImage() {
  const fonts = await loadOgFonts();

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
              A DAILY WALK THROUGH HISTORY
            </div>
            <div
              style={{
                marginTop: "13px",
                display: "flex",
                fontFamily: "Fraunces, serif",
                fontSize: "90px",
                fontWeight: 700,
                lineHeight: 1,
                color: colors.ink,
                letterSpacing: "-0.035em",
              }}
            >
              On This Day
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
              Discover the events, notable lives, and holidays that shaped
              today.
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
      ...size,
      fonts,
    },
  );
}
