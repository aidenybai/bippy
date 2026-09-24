"use client";

import { useTranslations } from "next-intl";

export const Greeting = (props: { name: string }) => {
  const t = useTranslations("Index");
  return (
    <p>
      {t("greeting", { name: props.name })}
      <br />
    </p>
  );
};
