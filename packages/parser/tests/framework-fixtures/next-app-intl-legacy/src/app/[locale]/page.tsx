import { getLocale, getTranslations, unstable_setRequestLocale } from "next-intl/server";

export default async function IndexPage(props: { params: { locale: string } }) {
  unstable_setRequestLocale(props.params.locale);
  const t = await getTranslations("Index");
  const locale = await getLocale();
  return (
    <main>
      <h1>
        {t("title")}
        <br />
      </h1>
      <p>
        {locale}
        <br />
      </p>
    </main>
  );
}
