const { createMDX } = require('fumadocs-mdx/next');

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['fumadocs-ui', 'bippy'],
  
  pageExtensions: ['js', 'jsx', 'mdx', 'ts', 'tsx'],
  
  output: 'export',
};

module.exports = withMDX(nextConfig);
