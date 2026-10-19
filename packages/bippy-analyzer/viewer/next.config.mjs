/** @type {import("next").NextConfig} */
const nextConfig = {
  devIndicators: false,
  experimental: {
    reactCompiler: true,
  },
  allowedDevOrigins: ["macmini.tail5e921d.ts.net", "100.111.151.66"],
};

export default nextConfig;
