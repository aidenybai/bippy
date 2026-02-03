const nextConfig = {
  redirects: async () => [
    {
      source: "/:path*",
      destination: "https://github.com/aidenybai/bippy#readme",
      permanent: true
    }
  ]
};

export default nextConfig;
