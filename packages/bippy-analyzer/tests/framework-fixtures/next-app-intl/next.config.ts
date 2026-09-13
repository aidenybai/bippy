import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const baseConfig: NextConfig = {
  reactStrictMode: true,
};

const withNextIntl = createNextIntlPlugin("./src/libs/i18n.ts");

export default withNextIntl(baseConfig);
