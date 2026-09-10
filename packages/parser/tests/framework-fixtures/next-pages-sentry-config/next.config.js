const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: { styledComponents: true },
};

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  widenClientFileUpload: true,
});
