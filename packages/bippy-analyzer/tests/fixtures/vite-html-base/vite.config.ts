import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const BASE_HREF_PLACEHOLDER = "__BASE_HREF__";
const TITLE_PLACEHOLDER = "__TITLE__";

interface AppConfig {
  edition: string;
}

const readAppConfig = (): AppConfig =>
  JSON.parse(readFileSync(resolve(process.cwd(), "app.config.json"), "utf8"));

const baseHrefPlugin = (): Plugin => ({
  name: "base-href-placeholder",
  transformIndexHtml: (html) => html.replace(BASE_HREF_PLACEHOLDER, "/console/"),
});

const documentTitlePlugin = (): Plugin => ({
  name: "document-title",
  transformIndexHtml: {
    order: "pre",
    handler: (html, context) => ({
      html: html.replace(TITLE_PLACEHOLDER, "Console"),
      tags: [
        { tag: "meta", attrs: { name: "app-edition", content: readAppConfig().edition } },
        {
          tag: "meta",
          attrs: { name: "served-base", content: context.server?.config.base ?? "(no server)" },
        },
      ],
    }),
  },
});

export default defineConfig({
  plugins: [documentTitlePlugin(), baseHrefPlugin()],
});
