import { c as _c } from "react/compiler-runtime";
import { useState } from "react";

export function CompiledToggle() {
  const $ = _c(4);
  const [on, setOn] = useState(false);
  let t0;
  if ($[0] !== on) {
    t0 = () => setOn(!on);
    $[0] = on;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  let t1;
  if ($[2] !== t0) {
    t1 = <button onClick={t0}>{on ? "on" : "off"}</button>;
    $[2] = t0;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  return t1;
}

export function CompiledLabel() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <p>label</p>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
