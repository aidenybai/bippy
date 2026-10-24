import { cloneElement, createElement, isValidElement } from "react";
import type { ReactNode } from "react";

interface FunctionComponent {
  (props: Record<string, unknown>): unknown;
}

interface ServerRender {
  output: unknown;
}

export const isAsyncFunction = (
  value: unknown,
): value is (props: Record<string, unknown>) => Promise<unknown> =>
  typeof value === "function" && value.constructor.name === "AsyncFunction";

export const isFunctionComponent = (value: unknown): value is FunctionComponent =>
  typeof value === "function" && !Reflect.get(Object(value.prototype), "isReactComponent");

const createResolvedComponent = (type: unknown, output: unknown): (() => ReactNode) => {
  const resolved = (): ReactNode => output as ReactNode;
  Object.defineProperty(resolved, "name", { value: Reflect.get(Object(type), "name") });
  const displayName: unknown = Reflect.get(Object(type), "displayName");
  if (displayName) Object.assign(resolved, { displayName });
  return resolved;
};

export const callServerComponent = async (
  type: FunctionComponent,
  props: Record<string, unknown>,
): Promise<ServerRender | null> => {
  try {
    return { output: await type(props) };
  } catch {
    return null;
  }
};

export const resolveServerTree = async (
  node: unknown,
  isEveryComponent = false,
): Promise<unknown> => {
  if (Array.isArray(node))
    return Promise.all(node.map((item) => resolveServerTree(item, isEveryComponent)));
  if (node instanceof Promise) return resolveServerTree(await node, isEveryComponent);
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  const rendered =
    isAsyncFunction(node.type) || (isEveryComponent && isFunctionComponent(node.type))
      ? await callServerComponent(node.type, node.props)
      : null;
  if (rendered)
    return createElement(
      createResolvedComponent(
        node.type,
        await resolveServerTree(rendered.output, isEveryComponent),
      ),
      { key: node.key },
    );
  const props = await Promise.all(
    Object.entries(node.props).map(async ([name, value]) => [
      name,
      isValidElement(value) || Array.isArray(value)
        ? await resolveServerTree(value, isEveryComponent)
        : value,
    ]),
  );
  return cloneElement(node, Object.fromEntries(props));
};
