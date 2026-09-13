import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

i18n.load("de", {
  greeting: ["Hallo ", ["name"], "!"],
  docs: "Lies die <0>Dokumentation</0> oder <1/>",
  intro: ["Willkommen zurück, ", ["0"], "."],
  footer: "Fußzeile",
  empty: "",
});
i18n.activate("de");

createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <App />
  </I18nProvider>,
);
