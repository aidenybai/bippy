import { STAND_IN } from "./stand-in";

// HACK: next-intl/server needs a request; translations render as their keys.
interface TranslationOptions {
  namespace?: string;
}

const createTranslator = (namespace: string | undefined) => {
  const translate = (key: string): string => (namespace ? `${namespace}.${key}` : key);
  return Object.assign(translate, {
    rich: translate,
    markup: translate,
    raw: translate,
    has: () => true,
  });
};

export const setRequestLocale = () => undefined;
export const unstable_setRequestLocale = setRequestLocale;
export const getTranslations = async (options?: string | TranslationOptions) =>
  createTranslator(typeof options === "string" ? options : options?.namespace);
export const getLocale = async () => "en";
export const getMessages = async () => ({});
export const getNow = async () => new Date(0);
export const getTimeZone = async () => "UTC";
export const getFormatter = async () => STAND_IN;
export const getRequestConfig = <Config>(createConfig: Config): Config => createConfig;
