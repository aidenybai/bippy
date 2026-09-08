const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

module.exports = (phase, { defaultConfig }) => ({
  ...defaultConfig,
  reactStrictMode: true,
  poweredByHeader: phase === PHASE_DEVELOPMENT_SERVER,
});
