import i18next from "i18next";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";

const resources = {
  en: {
    translation: {
      actions: {
        next: "Next",
        welcome: "Hello {{name}}",
      },
      auth: {
        signIn: "Sign in",
      },
    },
  },
};

i18next.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
});

const scoped = i18next.createInstance();
scoped.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
});

const Actions = () => {
  const { t } = useTranslation();
  return (
    <>
      <button>{t("actions.next")}</button>
      <p>{t("actions.welcome", { name: "Ada" })}</p>
    </>
  );
};

const fixedTranslation = scoped.getFixedT("en", "translation", "actions");

const I18next = () => (
  <I18nextProvider i18n={scoped}>
    <section>
      <Actions />
      <span>{fixedTranslation("next")}</span>
      <strong>{i18next.t("auth.signIn")}</strong>
    </section>
  </I18nextProvider>
);

export const isExact = true;

export default I18next;
