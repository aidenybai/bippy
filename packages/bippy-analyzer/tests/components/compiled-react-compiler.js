import { c as _c } from "react/compiler-runtime";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";

function Badge(t0) {
  const $ = _c(2);
  const { label } = t0;
  let t1;
  if ($[0] !== label) {
    t1 = _jsx("span", { className: "badge", children: label });
    $[0] = label;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}

function Toolbar(t0) {
  const $ = _c(8);
  const { items } = t0;
  const [count, setCount] = useState(0);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => setCount((previous) => previous + 1);
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const increment = t1;
  let t2;
  if ($[1] !== items) {
    t2 = items.map((item) => _jsx(Badge, { label: item }, item));
    $[1] = items;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== count) {
    t3 = _jsxs("button", { onClick: increment, children: ["clicked ", count] });
    $[3] = count;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t2 || $[6] !== t3) {
    t4 = _jsxs("nav", { children: [t2, t3] });
    $[5] = t2;
    $[6] = t3;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  return t4;
}

export default function CompiledApp() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = _jsx(Toolbar, { items: ["one", "two", "three"] });
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
