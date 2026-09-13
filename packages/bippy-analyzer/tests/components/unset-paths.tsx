import { useState } from "react";

// react-hook-form's `unset`: a recursive walk over a path the analysis cannot
// see (it is derived from the URL) must settle as unknown instead of following
// ever-branching `paths.slice(0, -1)` arguments to the call-depth limit.

type Container = Record<string, unknown>;

const isObject = (value: unknown): value is Container =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isKey = (value: string) => /^\w*$/.test(value);
const stringToPath = (input: string) =>
  input
    .replace(/["|']|\]/g, "")
    .split(/\.|\[/)
    .filter(Boolean);
const isEmptyObject = (value: unknown) => isObject(value) && !Object.keys(value).length;

const baseGet = (object: unknown, updatePath: string[]) => {
  const length = updatePath.slice(0, -1).length;
  let index = 0;
  while (index < length) {
    object = object === undefined ? index++ : (object as Container)[updatePath[index++]];
  }
  return object;
};

const unset = (object: Container, path: string | string[]): Container => {
  const paths = Array.isArray(path) ? path : isKey(path) ? [path] : stringToPath(path);
  const childObject = paths.length === 1 ? object : baseGet(object, paths);
  const index = paths.length - 1;
  const key = paths[index];
  if (isObject(childObject)) {
    delete childObject[key];
  }
  if (index !== 0 && isObject(childObject) && isEmptyObject(childObject)) {
    unset(object, paths.slice(0, -1));
  }
  return object;
};

const createFields = (): Container => ({ a: { b: { c: 1 } }, d: 2 });

export default function UnsetPaths() {
  const path = window.location.hash.slice(1) || "a.b.c";
  const [remaining] = useState(() => Object.keys(unset(createFields(), path)));
  return (
    <section>
      <h1>remaining fields</h1>
      <ul>
        {remaining.map((key) => (
          <li key={key}>{key}</li>
        ))}
      </ul>
    </section>
  );
}

export const minCoverage = 0.5;
