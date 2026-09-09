import type { StorybookConfig } from "@storybook/react-webpack5";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: { name: "@storybook/react-webpack5", options: {} },
  typescript: {
    check: false,
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
