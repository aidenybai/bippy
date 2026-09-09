import { defineConfig } from "vite";
import { docsMetadataPlugin } from "./docs-metadata-plugin";

export default defineConfig({
  plugins: [docsMetadataPlugin()],
});
