import { useTranslations } from "next-intl";

export default function AboutPage() {
  const t = useTranslations("About");
  return <h1>{t("title")}</h1>;
}
