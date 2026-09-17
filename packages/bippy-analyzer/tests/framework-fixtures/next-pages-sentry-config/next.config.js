const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(
  { reactStrictMode: true, compiler: { styledComponents: false } },
  { silent: true, hideSourceMaps: true },
);
