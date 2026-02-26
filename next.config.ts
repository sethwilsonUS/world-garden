import type { NextConfig } from "next";

const ttsPort = process.env.TTS_PORT ?? "3001";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/opengraph-image": ["./app/fonts/**/*"],
    "/twitter-image": ["./app/fonts/**/*"],
    "/article/\\[slug\\]/opengraph-image": ["./app/fonts/**/*"],
    "/article/\\[slug\\]/twitter-image": ["./app/fonts/**/*"],
  },
  rewrites: process.env.USE_PYTHON_TTS
    ? async () => [
        {
          source: "/api/tts",
          destination: `http://localhost:${ttsPort}/api/tts`,
        },
      ]
    : undefined,
};

export default nextConfig;
