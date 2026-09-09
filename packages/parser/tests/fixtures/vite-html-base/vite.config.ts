import { defineConfig, type Plugin } from "vite";

const BASE_HREF_PLACEHOLDER = "__BASE_HREF__";
const TITLE_PLACEHOLDER = "__TITLE__";

const baseHrefPlugin = (): Plugin => ({
  name: "base-href-placeholder",
  transformIndexHtml: (html) => html.replace(BASE_HREF_PLACEHOLDER, "/console/"),
});

const documentTitlePlugin = (): Plugin => ({
  name: "document-title",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => ({
      html: html.replace(TITLE_PLACEHOLDER, "Console"),
      tags: [{ tag: "meta", attrs: { name: "app-edition", content: "community" } }],
    }),
  },
});

export default defineConfig({
  plugins: [documentTitlePlugin(), baseHrefPlugin()],
});
