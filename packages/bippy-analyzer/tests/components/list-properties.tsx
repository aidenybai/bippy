import { useCallback, useState } from "react";

interface TranslationResult extends Array<unknown> {
  t: (key: string) => string;
  ready: boolean;
}

const useTranslationLike = (namespace: string): TranslationResult => {
  const memoizedT = useCallback((key: string) => `${namespace}:${key}`, [namespace]);
  const [t] = useState(() => memoizedT);
  const result: TranslationResult = Object.assign([t, {}, true], { t, ready: true });
  result.t = t;
  result.ready = true;
  return result;
};

const tagged = ["a", "b"];
tagged.label = "letters";
if (document.referrer.length > 0) {
  tagged.label = "many letters";
} else {
  tagged.label = "many letters";
}
tagged.length = 2;

export default function ListProperties() {
  const { t, ready } = useTranslationLike("common");
  const [first] = useTranslationLike("other");
  return (
    <section>
      <p>{t("greeting")}</p>
      <p>{first("greeting")}</p>
      {ready ? <b>ready</b> : <i>loading</i>}
      <em>{tagged.label}</em>
      <span>{tagged.length}</span>
    </section>
  );
}
