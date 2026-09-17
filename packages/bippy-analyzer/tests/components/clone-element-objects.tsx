import { cloneElement, createElement, isValidElement, type ReactNode } from "react";

// react-i18next's `Trans` walks a parsed translation with a `{ dummy: true,
// children }` root that is not an element, yet gets passed to `cloneElement`
// along with the rendered children. React only rejects null and undefined
// there: any other object is read for `type`, `key` and `props`, so the clone's
// `props.children` are the rendered children and the dummy's own `children`
// key never becomes a prop.

interface Placeholder {
  dummy: true;
  children: ReactNode[];
}

interface TranslationNode {
  index: number;
  text: string;
}

const renderTranslation = (nodes: TranslationNode[], components: ReactNode[]): ReactNode => {
  const root: Placeholder = { dummy: true, children: components };
  const rendered: ReactNode[] = nodes.map((node) => {
    const component = components[node.index] ?? root;
    if (isValidElement<{ children?: ReactNode }>(component)) {
      return cloneElement(component, { key: node.index }, node.text);
    }
    return node.text;
  });
  const clone = cloneElement(root, { key: 0 }, rendered);
  return clone.props.children;
};

const Trans = ({ children }: { children: ReactNode[] }) => (
  <p>
    {renderTranslation(
      [
        { index: 9, text: "Powered by " },
        { index: 0, text: "PLANKA" },
      ],
      children,
    )}
  </p>
);

/** `cloneElement` of an object carrying its own `type`, `key` and `props` builds that element. */
const FromDescriptor = () => {
  const descriptor = { type: "mark", key: "k", props: { title: "from descriptor" } };
  return cloneElement(descriptor, { lang: "en" }, "described");
};

const legacyChild = createElement("i", null, "legacy");

export default function CloneElementObjects() {
  return (
    <main>
      <Trans>
        <a href="https://planka.app">placeholder</a>
      </Trans>
      <FromDescriptor />
      {cloneElement(legacyChild, undefined, "replaced")}
      {cloneElement({ props: { children: "only props" } }).props.children}
    </main>
  );
}

export const isExact = true;
