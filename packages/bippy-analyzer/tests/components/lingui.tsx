import { i18n, setupI18n } from "@lingui/core";
import { I18nProvider, Trans, useLingui } from "@lingui/react";

// Lingui's runtime API as the macros expand to it: descriptors with `message`,
// positional `values` and tagged `components`, translated against a source
// locale catalog (the statically knowable half of the model).

i18n.load("en", {});
i18n.activate("en");

const scoped = setupI18n({ locale: "en", messages: { en: {} } });

const Greeting = ({ name }: { name: string }) => {
  const { _ } = useLingui();
  return <h1>{_({ id: "greeting", message: "Hello {0}", values: { 0: name } })}</h1>;
};

const Footer = () => {
  const { i18n: active } = useLingui();
  return (
    <footer>
      {active._("footer.copy", { year: 2026 }, { message: "Copyright {year} Acme" })}
      <Trans
        id="footer.links"
        message="Read the <0>docs</0> or <1/>"
        components={{ 0: <a href="/docs" />, 1: <hr /> }}
      />
    </footer>
  );
};

const Strong = ({ children }: { children?: React.ReactNode }) => <strong>{children}</strong>;

export default function Lingui() {
  return (
    <I18nProvider i18n={i18n}>
      <section>
        <Greeting name="Ada" />
        <p>
          <Trans id="intro" message="Welcome back, {0}." values={{ 0: <em>Grace</em> }} />
        </p>
        <Trans id="cta" message="Sign in" component={Strong} />
        <Trans
          id="tagline"
          message="Fast"
          render={({ translation }) => <small>{translation}</small>}
        />
        <Trans id="empty" message="" />
        <Footer />
        <I18nProvider i18n={scoped} defaultComponent={Strong}>
          <Trans id="nested" message="Nested" />
        </I18nProvider>
      </section>
    </I18nProvider>
  );
}
