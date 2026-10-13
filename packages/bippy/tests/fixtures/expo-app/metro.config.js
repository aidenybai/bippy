const { getDefaultConfig } = require("expo/metro-config");
const withMonorepoMetro = require("../shared/with-monorepo-metro.cjs");

module.exports = withMonorepoMetro(__dirname, getDefaultConfig(__dirname));
