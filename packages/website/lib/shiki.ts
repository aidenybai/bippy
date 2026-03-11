import { createHighlighter, type Highlighter } from "shiki";

declare global {
  var __shiki_highlighter__: Highlighter | undefined;
}

let pendingInit: Promise<Highlighter> | null = null;

const getHighlighter = (): Promise<Highlighter> => {
  if (globalThis.__shiki_highlighter__) {
    return Promise.resolve(globalThis.__shiki_highlighter__);
  }

  if (!pendingInit) {
    pendingInit = createHighlighter({
      themes: ["vesper"],
      langs: ["typescript", "javascript", "jsx", "tsx", "bash", "shell", "json"],
    }).then((instance) => {
      globalThis.__shiki_highlighter__ = instance;
      pendingInit = null;
      return instance;
    });
  }

  return pendingInit;
};

export const highlight = async (code: string, language: string = "bash"): Promise<string> => {
  const instance = await getHighlighter();
  return instance.codeToHtml(code, { lang: language, theme: "vesper" });
};
