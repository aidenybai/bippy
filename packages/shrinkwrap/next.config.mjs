import { readFileSync } from 'node:fs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  logging: {
    fetches: {
      fullUrl: true
    }
  },
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  env: {
    BIPPY_SOURCE: readFileSync(
      'node_modules/bippy/dist/index.global.js',
      'utf-8',
    ),
    INJECT_SOURCE: readFileSync(
      'inject/dist/index.global.js',
      'utf-8',
    ),
  },
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
