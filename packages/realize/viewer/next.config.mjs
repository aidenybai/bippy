const ANALYZER_FILES = [
  ".analyzer/**",
  "../tests/fixtures/**",
  "../../../node_modules/typescript/**",
  "../../../node_modules/@typescript/typescript-*/**",
  "../../../node_modules/tla-ts/**",
  "../../../node_modules/fflate/**",
  "../../../node_modules/react/**",
  "../../../node_modules/@types/react/**",
  "../../../node_modules/csstype/**",
];

const nextConfig = {
  agentRules: false,
  devIndicators: false,
  reactCompiler: true,
  allowedDevOrigins: ["macmini.tail5e921d.ts.net", "100.111.151.66"],
  outputFileTracingIncludes: { "/**": ANALYZER_FILES },
};

export default nextConfig;
