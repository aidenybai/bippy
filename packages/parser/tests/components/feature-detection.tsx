import { useLayoutEffect, useRef, useState } from "react";

const objectKeys =
  typeof Object.keys === "function"
    ? (value: object) => Object.keys(value)
    : (value: object) => {
        const keys: string[] = [];
        for (const key in value) keys.push(key);
        return keys;
      };

const describeBuiltins = (): string =>
  [
    typeof Object.prototype.hasOwnProperty,
    typeof Array.isArray,
    typeof JSON.parse,
    typeof Math.max,
    typeof Object.prototype,
    typeof Function.prototype,
    typeof Symbol.iterator,
    typeof Promise.resolve,
  ].join(",");

const Detected = () => {
  const keys = objectKeys({ alpha: 1, beta: 2 });
  return (
    <ul>
      {keys.map((key) => (
        <li key={key}>{key}</li>
      ))}
      <li>{describeBuiltins()}</li>
    </ul>
  );
};

const DatasetReader = () => {
  const ref = useRef<HTMLElement>(null);
  const [label, setLabel] = useState("pending");
  useLayoutEffect(() => {
    const dataset = ref.current?.dataset;
    setLabel(dataset ? `${dataset.role}:${dataset.index}` : "missing");
  }, []);
  return (
    <section ref={ref} data-role="reader" data-index="3">
      {label === "reader:3" ? <b>dataset read</b> : <i>{label}</i>}
    </section>
  );
};

export default function FeatureDetection() {
  return (
    <main>
      <Detected />
      <DatasetReader />
    </main>
  );
}

export const isExact = true;
