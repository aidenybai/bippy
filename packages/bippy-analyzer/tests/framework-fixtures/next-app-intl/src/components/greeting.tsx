"use client";

import { useLocale, useTranslations } from "next-intl";

export const Greeting = (props: { name: string; visitors: number }) => {
  const t = useTranslations("Index");
  const locale = useLocale();
  return (
    <section lang={locale}>
      <h1>
        {t("greeting", { name: props.name })}
        <br />
      </h1>
      <p>
        {t("visitors", { count: props.visitors })}
        <br />
        {t("visitors", { count: 0 })}
        <br />
        {t("elapsed", { ms: Date.now() % 1000 })}
      </p>
      <p>{t.rich("rich", { docs: (chunks) => <a href="/docs">{chunks}</a> })}</p>
    </section>
  );
};
