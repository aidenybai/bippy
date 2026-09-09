declare global {
  interface Window {
    injectedPhrases?: Record<string, unknown>;
  }
}

const fallbackPhrases: Record<string, string> = { greeting: "hello", count: "many" };

const readInjected = (key: string): unknown => window.injectedPhrases?.[key];

const transformPhrase = (phrase: unknown): string => {
  if (typeof phrase !== "string") throw new TypeError("expects a string");
  return phrase.toUpperCase();
};

export const translate = (key: string): string => {
  const injected = readInjected(key);
  const phrase = typeof injected === "string" ? injected : fallbackPhrases[key];
  return transformPhrase(phrase);
};

export const formatCount = (key: string): string => {
  const injected = readInjected(key);
  if (typeof injected === "number") return injected.toFixed(1);
  return fallbackPhrases[key];
};
