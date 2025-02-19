import { readFileSync } from 'node:fs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  logging: {
    fetches: {
      fullUrl: true
    }
  },
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  webpack: (config, { isServer }) => {
    config.module.rules.push({
      test: /\.js\.map$/,
      use: 'null-loader',
    });

    // Add support for importing source bundles
    config.module.rules.push({
      test: /\.global\.js$/,
      type: 'asset/source',
      parser: {
        dataUrlCondition: {
          maxSize: 1000 * 1024 // 1MB
        }
      }
    });

    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false
    };

    return config;
  }
};

export default nextConfig;
