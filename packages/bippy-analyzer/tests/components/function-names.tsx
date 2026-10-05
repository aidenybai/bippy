import React from "react";

const isProduction = ["development"].includes("production");

const Devtools = isProduction
  ? () => null
  : function NamedDevtools() {
      return <aside>devtools</aside>;
    };

const Fallback = isProduction
  ? function () {
      return null;
    }
  : function Panel() {
      return <section>panel</section>;
    };

const Guarded = null || (() => <b>guarded</b>);
const Sequenced = (0, () => <i>sequenced</i>);
const Parenthesized = () => <u>parenthesized</u>;
const Nullish = undefined ?? (() => <s>nullish</s>);

const App = () => (
  <main>
    <Devtools />
    <Fallback />
    <Guarded />
    <Sequenced />
    <Parenthesized />
    <Nullish />
  </main>
);

export default App;
