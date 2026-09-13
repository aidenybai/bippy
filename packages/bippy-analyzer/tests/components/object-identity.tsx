import { useId } from "react";

const list = ["x"];
const record = { x: 1 };
const table = new Map<object, string>([[list, "list"]]);

const describeKind = (value: unknown): string => {
  const constructor = value && (value as { constructor: unknown }).constructor;
  if (Object(value) !== value) return `primitive:${typeof value}`;
  if (constructor == Date) return "date";
  if (constructor == RegExp) return "regexp";
  if (constructor == Array) return "array";
  if (constructor == Object) return "object";
  return "other";
};

const quoted = (id: string): string => (Object(id) === id ? "boxed" : JSON.stringify(id));

export default function ObjectIdentity() {
  const id = useId();
  const hashed = `@${quoted(id)},`;
  const fallback: Record<string, string> = {};
  const facts: [string, string | boolean][] = [
    ["string", describeKind("abc")],
    ["id", describeKind(id)],
    ["number", describeKind(42)],
    ["list", describeKind(list)],
    ["record", describeKind(record)],
    ["date", describeKind(new Date(0))],
    ["regexp", describeKind(/x/)],
    ["map", describeKind(new Map())],
    ["boxed-strict", Object("abc") === "abc"],
    ["boxed-loose", Object("abc") == "abc"],
    ["empty-date", "" == Date],
    ["list-record", list == record],
    ["boxed-list", Object(list) === list],
    ["table", table.get(Object(list)) ?? "none"],
    ["id-constructor", id.constructor === String],
    ["boxed-prototype", Object.getPrototypeOf(Object(1)) === Number.prototype],
    ["empty-lookup", fallback[hashed] === undefined ? "missing" : "present"],
    ["quoted", hashed.startsWith('@"') ? "quoted" : "bare"],
  ];
  return (
    <ul>
      {facts.map(([label, value]) => (
        <li key={label}>
          {label}: {String(value)}
        </li>
      ))}
    </ul>
  );
}

export const isExact = true;
