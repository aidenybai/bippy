import {
  isArray,
  isBoolean,
  isFunction,
  isNil,
  isNull,
  isNumber,
  isObject,
  isObjectLike,
  isPlainObject,
  isString,
  isUndefined,
} from "lodash-es";
import { createContext, type ReactNode } from "react";

// Semantic UI React's shorthand factories and `partitionHTMLProps` decide how
// to render from lodash type predicates applied to elements, components,
// functions and class instances: values with a decided type that lodash's own
// source cannot run on natively.

class Model {
  readonly id = 1;
}

const Theme = createContext("light");

const Label = ({ children }: { children: ReactNode }) => <b>{children}</b>;

const describe = (label: string, verdict: boolean) => (
  <li data-label={label}>{verdict ? "yes" : "no"}</li>
);

const nullProto: object = Object.create(null);

/** Semantic UI's `createShorthand`: strings become children, elements are cloned, plain objects are props. */
const shorthand = (value: unknown): ReactNode => {
  if (isNil(value) || isBoolean(value)) return null;
  if (isString(value) || isNumber(value)) return <span>{String(value)}</span>;
  if (isFunction(value)) return <output>function</output>;
  if (isPlainObject(value)) return <code>props</code>;
  return <em>element</em>;
};

export default function LodashTypePredicates() {
  const element = <Label>hi</Label>;
  return (
    <main>
      <ul>
        {describe("nil-null", isNil(null))}
        {describe("nil-undefined", isNil(undefined))}
        {describe("nil-zero", isNil(0))}
        {describe("null-undefined", isNull(undefined))}
        {describe("undefined-undefined", isUndefined(undefined))}
        {describe("string", isString("planka"))}
        {describe("string-boxed", isString(new String("boxed")))}
        {describe("string-number", isString(4))}
        {describe("number", isNumber(4))}
        {describe("number-nan", isNumber(Number.NaN))}
        {describe("boolean", isBoolean(false))}
        {describe("array", isArray([1]))}
        {describe("array-object", isArray({ length: 1 }))}
        {describe("object-like-element", isObjectLike(element))}
        {describe("object-like-function", isObjectLike(Label))}
        {describe("object-function", isObject(Label))}
        {describe("object-class", isObject(Model))}
        {describe("object-string", isObject("s"))}
        {describe("function-component", isFunction(Label))}
        {describe("function-class", isFunction(Model))}
        {describe("function-element", isFunction(element))}
        {describe("plain-literal", isPlainObject({ size: "small" }))}
        {describe("plain-null-proto", isPlainObject(nullProto))}
        {describe("plain-instance", isPlainObject(new Model()))}
        {describe("plain-element", isPlainObject(element))}
        {describe("plain-context", isPlainObject(Theme))}
        {describe("plain-array", isPlainObject([]))}
        {describe("plain-date", isPlainObject(new Date(0)))}
        {describe("plain-regexp", isPlainObject(/x/))}
        {describe("plain-map", isPlainObject(new Map()))}
      </ul>
      <ol>
        <li>{shorthand(null)}</li>
        <li>{shorthand(true)}</li>
        <li>{shorthand("text")}</li>
        <li>{shorthand(3)}</li>
        <li>{shorthand(Label)}</li>
        <li>{shorthand({ content: "x" })}</li>
        <li>{shorthand(element)}</li>
      </ol>
    </main>
  );
}

export const isExact = true;
