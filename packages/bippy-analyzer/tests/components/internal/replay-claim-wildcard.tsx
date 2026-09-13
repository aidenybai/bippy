import { createElement } from "react";

export default () => (
  <main>
    <header />
    {createElement(`widget-${Math.random()}`)}
    <footer />
  </main>
);
