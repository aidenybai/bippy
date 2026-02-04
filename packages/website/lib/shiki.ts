import { createHighlighter, type Highlighter } from 'shiki';

let highlighter: Highlighter | null = null;

const getHighlighter = async (): Promise<Highlighter> => {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ['vesper'],
      langs: ['typescript', 'javascript', 'jsx', 'tsx', 'bash', 'shell', 'json'],
    });
  }
  return highlighter;
};

export const highlight = async (code: string, language: string = 'bash'): Promise<string> => {
  const instance = await getHighlighter();
  return instance.codeToHtml(code, { lang: language, theme: 'vesper' });
};
