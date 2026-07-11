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
      themes: ["vesper", "min-light"],
      langs: ["typescript", "javascript", "jsx", "tsx", "bash", "shell", "json"],
    }).then((instance) => {
      globalThis.__shiki_highlighter__ = instance;
      pendingInit = null;
      return instance;
    });
  }

  return pendingInit;
};

const SHIKI_THEMES = { dark: "vesper", light: "min-light" };

export const highlight = async (code: string, language: string = "bash"): Promise<string> => {
  const instance = await getHighlighter();
  return instance.codeToHtml(code, { lang: language, themes: SHIKI_THEMES });
};

export const highlightWithLineEmphasis = async (
  code: string,
  language: string,
  emphasizedLines: number[],
): Promise<string> => {
  const instance = await getHighlighter();
  const emphasizedLineSet = new Set(emphasizedLines);
  return instance.codeToHtml(code, {
    lang: language,
    themes: SHIKI_THEMES,
    transformers: [
      {
        line(lineNode, lineNumber) {
          this.addClassToHast(
            lineNode,
            emphasizedLineSet.has(lineNumber) ? "line-emphasized" : "line-dimmed",
          );
        },
      },
    ],
  });
};
