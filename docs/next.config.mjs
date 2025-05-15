import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['img.shields.io'],
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
