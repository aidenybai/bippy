const { withSentryConfig } = require("@sentry/nextjs");
const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

module.exports = withSentryConfig(
  async (phase) => ({ reactStrictMode: phase === PHASE_DEVELOPMENT_SERVER }),
  { silent: true },
);
