const { fixupConfigRules } = require("@eslint/compat");
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  ...fixupConfigRules(expoConfig),
  {
    files: ["src/data/convexPublicApi.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              allowImportNames: ["makeFunctionReference"],
              message:
                "This audited client seam may use only Convex's function-reference factory.",
              name: "convex/server",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [".expo/**", "coverage/**", "dist/**", "ios/**", "android/**"],
  },
]);
