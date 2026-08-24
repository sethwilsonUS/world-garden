import type { NextConfig } from "next";
import type { webpack as WebpackTypes } from "next/dist/compiled/webpack/webpack";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ttsPort = process.env.TTS_PORT ?? "3001";
const MAPLIBRE_ASSET_PLUGIN = "MapLibreAssetPlugin";
const maplibreDist = resolve(
  import.meta.dirname,
  "node_modules/maplibre-gl/dist",
);
const maplibreAssets = [
  "maplibre-gl-shared.mjs",
  "maplibre-gl-worker.mjs",
] as const;

const nextConfig: NextConfig = {
  transpilePackages: ["@curio-garden/domain"],
  webpack: (config, { webpack }) => {
    config.plugins.push({
      apply(compiler: WebpackTypes.Compiler) {
        compiler.hooks.thisCompilation.tap(
          MAPLIBRE_ASSET_PLUGIN,
          (compilation: WebpackTypes.Compilation) => {
            compilation.hooks.processAssets.tap(
              {
                name: MAPLIBRE_ASSET_PLUGIN,
                stage:
                  webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
              },
              () => {
                for (const asset of maplibreAssets) {
                  compilation.emitAsset(
                    `static/maplibre/${asset}`,
                    new webpack.sources.RawSource(
                      readFileSync(resolve(maplibreDist, asset)),
                    ),
                  );
                }
              },
            );
          },
        );
      },
    });

    return config;
  },
  redirects: async () => [
    {
      source: "/:path*",
      has: [
        {
          type: "host",
          value: "www.curiogarden.org",
        },
      ],
      destination: "https://curiogarden.org/:path*",
      permanent: true,
    },
  ],
  outputFileTracingIncludes: {
    "/opengraph-image": ["./app/fonts/**/*"],
    "/twitter-image": ["./app/fonts/**/*"],
    "/article/[slug]/opengraph-image": ["./app/fonts/**/*"],
    "/article/[slug]/twitter-image": ["./app/fonts/**/*"],
  },
  rewrites: process.env.USE_PYTHON_TTS
    ? async () => [
        {
          source: "/api/tts/edge",
          destination: `http://localhost:${ttsPort}/api/tts`,
        },
      ]
    : undefined,
};

export default nextConfig;
