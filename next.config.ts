import type { NextConfig } from "next";

const ttsPort = process.env.TTS_PORT ?? "3001";

const nextConfig: NextConfig = {
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
