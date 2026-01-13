import { codeToHtml } from "shiki";

export const highlight = async (code: string, lang: string = "typescript") => {
  const html = await codeToHtml(code, {
    lang,
    theme: "vesper",
  });
  return html.replace(/background-color:#[0-9a-fA-F]+/g, "background-color:transparent");
};
