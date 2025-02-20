import { extractColors } from 'extract-colors';


export const registerGlobal = (name: string, value: any) => {
  // biome-ignore lint/suspicious/noExplicitAny: used by puppeteer
  (globalThis as any)[name] = value;
};

registerGlobal('extractColors', extractColors);
