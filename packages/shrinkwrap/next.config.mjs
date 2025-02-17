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
    get BIPPY_SOURCE() {
      return readFileSync(
        'node_modules/bippy/dist/index.global.js',
        'utf-8',
      );
    },
    get INJECT_SOURCE() {
      return readFileSync(
        'inject/dist/index.global.js',
        'utf-8',
      );
    },
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
