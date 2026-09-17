import { createContext, Fragment, type ReactElement, type ReactNode, useContext } from "react";

type Dictionary = Record<string, string>;

const dictionaries: Record<string, Dictionary> = {
  en: {
    greeting: "Hello, {name}!",
    items: "You have {count} items",
    rich: "Read the <link>docs</link> and <b>enjoy</b>",
    empty: "",
  },
  de: {
    greeting: "Hallo, {name}!",
    items: "Du hast {count} Artikel",
    rich: "Lies die <link>Doku</link> und <b>viel Spaß</b>",
    empty: "",
  },
};

const LocaleContext = createContext("en");

const interpolate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? `{${key}}`));

const useTranslation = () => {
  const locale = useContext(LocaleContext);
  const dictionary = dictionaries[locale] ?? dictionaries.en;
  const translate = (key: string, values: Record<string, string | number> = {}) =>
    interpolate(dictionary[key] ?? key, values);
  return { t: translate, locale };
};

/** Splits `before <tag>inner</tag> after` into text and wrapped element nodes. */
const Trans = ({
  i18nKey,
  components,
}: {
  i18nKey: string;
  components: Record<string, ReactElement<{ children?: ReactNode }>>;
}) => {
  const { t } = useTranslation();
  const parts = t(i18nKey).split(/(<\w+>[^<]*<\/\w+>)/);
  return (
    <p>
      {parts.map((part, index) => {
        const match = /^<(\w+)>([^<]*)<\/\w+>$/.exec(part);
        if (!match) return <Fragment key={index}>{part}</Fragment>;
        const [, tagName, inner] = match;
        const Wrapper = components[tagName];
        return (
          <Wrapper.type key={index} {...Wrapper.props}>
            {inner}
          </Wrapper.type>
        );
      })}
    </p>
  );
};

const Greeting = ({ name }: { name: string }) => {
  const { t } = useTranslation();
  return <h2>{t("greeting", { name })}</h2>;
};

const Count = ({ count }: { count: number }) => {
  const { t, locale } = useTranslation();
  return (
    <p lang={locale}>
      {t("items", { count })}
      {t("empty")}
      {t("missing.key")}
    </p>
  );
};

export default function I18n() {
  return (
    <div>
      <Greeting name="Ada" />
      <Count count={3} />
      <LocaleContext value="de">
        <Greeting name="Grace" />
        <Trans i18nKey="rich" components={{ link: <a href="/docs" />, b: <b /> }} />
      </LocaleContext>
    </div>
  );
}
