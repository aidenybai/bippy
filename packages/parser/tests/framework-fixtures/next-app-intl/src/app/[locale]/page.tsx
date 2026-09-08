import { getTranslations, setRequestLocale } from "next-intl/server";
import { Greeting } from "@/components/greeting";
import { Link } from "@/libs/navigation";

export default async function IndexPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "RootLayout" });
  return (
    <main>
      <nav>
        <Link href="/">{t("home_link")}</Link>
        <Link href="/about">{t("about_link")}</Link>
      </nav>
      <Greeting name="Ada" visitors={2} />
    </main>
  );
}
