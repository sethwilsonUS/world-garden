const { fixupConfigRules } = require("@eslint/compat");
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  ...fixupConfigRules(expoConfig),
  {
    ignores: [".expo/**", "coverage/**", "dist/**", "ios/**", "android/**"],
  },
]);
