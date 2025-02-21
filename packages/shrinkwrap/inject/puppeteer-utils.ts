import { extractColors } from 'extract-colors';

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export const registerGlobal = (name: string, value: any) => {
  // biome-ignore lint/suspicious/noExplicitAny: used by puppeteer
  (globalThis as any)[name] = value;
};

registerGlobal('extractColors', extractColors);
