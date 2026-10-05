/* eslint-disable no-var -- `var` hoisting is the behavior under test. */
import * as React from "react";

// create-react-class / fbjs: `if (process.env.NODE_ENV !== "production") { var warning = ... }`
// at module level declares a function-scoped `var` that every function in the module can read.
if (typeof document !== "undefined") {
  var describeEnvironment = (label: string): string => `${label}:browser`;
}

for (var counter = 0; counter < 3; counter += 1) {
  var lastCounter = counter;
}

{
  var blockScoped = "block";
}

if (typeof document === "undefined") {
  var serverOnly = "server";
}

const readEnvironment = (): string => describeEnvironment("env");

export const isExact = true;

export default function App() {
  return (
    <ul>
      {readEnvironment() === "env:browser" ? <li>browser</li> : <b>other</b>}
      {counter === 3 ? <li>3</li> : <b>{counter}</b>}
      {lastCounter === 2 ? <li>2</li> : <b>{lastCounter}</b>}
      {blockScoped === "block" ? <li>block</li> : <b>{blockScoped}</b>}
      {serverOnly === undefined ? <li>undefined</li> : <b>{serverOnly}</b>}
    </ul>
  );
}
