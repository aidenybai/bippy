import { defineConfig } from "vite";
import { flatYamlPlugin } from "./yaml-plugin";

export default defineConfig({
  plugins: [flatYamlPlugin()],
});
