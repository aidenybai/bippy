import { createElement, Fragment } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { jsxDEV } from "react/jsx-dev-runtime";

const Row = ({ index }) => jsx("tr", { children: jsx("td", { children: `row ${index}` }) });

export const App = ({ rows }) => {
  const items = [];
  for (let index = 0; index < rows; index++) items.push(jsx(Row, { index }, index));
  return jsxs(Fragment, {
    children: [
      createElement("h2", { className: "title" }, "Compiled", " ", "JSX"),
      jsxs("table", { children: [jsx("tbody", { children: items })] }),
      jsxDEV("footer", { children: "dev" }, undefined, false, undefined, undefined),
    ],
  });
};
