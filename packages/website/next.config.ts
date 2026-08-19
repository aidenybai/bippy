import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  redirects: async () => [
    {
      source: "/:path(llm\\.txt|llms\\.txt)",
      destination: "https://aidenybai.com/bippy/llms.txt",
      permanent: true,
    },
  ],
};

export default nextConfig;
