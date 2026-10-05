import { Trans, useLingui } from "@lingui/react";

const Footer = () => {
  const { _, i18n } = useLingui();
  return (
    <footer lang={i18n.locale}>
      {_({ id: "footer", message: "Footer" })}
      <Trans id="empty" message="Nothing to see" />
    </footer>
  );
};

export const App = () => (
  <main>
    <h1>
      <Trans id="greeting" message="Hello {name}!" values={{ name: "Ada" }} />
    </h1>
    <p>
      <Trans
        id="docs"
        message="Read the <0>docs</0> or <1/>"
        components={{ 0: <a href="/docs" />, 1: <hr /> }}
      />
    </p>
    <p>
      <Trans id="intro" message="Welcome back, {0}." values={{ 0: <em>Grace</em> }} />
    </p>
    <p>
      <Trans id="untranslated" message="Not translated yet" />
    </p>
    <Footer />
  </main>
);
