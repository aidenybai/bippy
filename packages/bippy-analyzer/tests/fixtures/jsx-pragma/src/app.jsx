/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag HFragment */
import { createElement, Fragment } from "react";

const HFragment = Fragment;

const Tone = ({ tone, children }) => <div data-tone={tone}>{children}</div>;

const h = (type, props, ...children) => {
  if (props?.tone === undefined) return createElement(type, props, ...children);
  const { tone, ...rest } = props;
  return createElement(Tone, { tone }, createElement(type, rest, ...children));
};

const Row = ({ index }) => <li>Row {index}</li>;

export const App = () => (
  <>
    <section tone="warm">
      <h1>Pragmas</h1>
      <p>Classic factory</p>
    </section>
    <ul>
      {[1, 2, 3].map((index) => (
        <Row key={index} index={index} />
      ))}
    </ul>
  </>
);
