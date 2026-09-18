import Trans from "next-translate/Trans";
import useTranslation from "next-translate/useTranslation";

const Translated = () => {
  const { t } = useTranslation("common");
  return (
    <main>
      <p>{t("hello", { name: "Ada" })}</p>
      <Trans
        i18nKey="common:rich"
        values={{ name: "Ada" }}
        components={{ strong: <strong /> }}
      />
    </main>
  );
};

export default Translated;
