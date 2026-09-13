// i18next's language detection canonicalizes every candidate code through
// `Intl.getCanonicalLocales` and treats a RangeError as "not a language tag".

const canonicalize = (code: string): string => {
  try {
    return Intl.getCanonicalLocales(code)[0];
  } catch (error) {
    return error instanceof RangeError ? "invalid" : "unexpected";
  }
};

export default function IntlLocales() {
  return (
    <ul>
      <li>{canonicalize("EN-us")}</li>
      <li>{canonicalize("de")}</li>
      <li>{canonicalize("not a tag")}</li>
      <li>{Intl.getCanonicalLocales(["fr-fr", "fr-FR", "JA"]).join(",")}</li>
      <li>{Intl.getCanonicalLocales().length}</li>
    </ul>
  );
}

export const isExact = true;
