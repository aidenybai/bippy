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

    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false
    };

    return config;
  }
};


export default nextConfig;
