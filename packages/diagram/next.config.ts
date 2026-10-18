import withStyleX from "@stylexswc/nextjs-plugin";

export default withStyleX({
  rsOptions: {
    unstable_moduleResolution: { type: "commonJS" },
  },
})({
  devIndicators: false,
  transpilePackages: ["tailwind-stylex"],
});
