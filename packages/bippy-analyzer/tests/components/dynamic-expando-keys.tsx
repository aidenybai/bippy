const createUID = (): string =>
  Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, "")
    .substring(0, 5);

interface Editor {
  key: string;
}

const createEditor = (): Editor => ({ key: createUID() });

interface KeyedNode {
  [expando: `__lexicalKey_${string}`]: string | undefined;
}

const createKeyedNode = (tagName: string): KeyedNode => document.createElement(tagName);

const setNodeKeyOnDOMNode = (dom: KeyedNode, editor: Editor, nodeKey: string): void => {
  dom[`__lexicalKey_${editor.key}`] = nodeKey;
};

const getNodeKeyFromDOMNode = (dom: KeyedNode, editor: Editor): string | undefined =>
  dom[`__lexicalKey_${editor.key}`];

const describeKey = (nodeKey: string | undefined): string =>
  nodeKey === undefined ? "none" : `key:${nodeKey}`;

const editor = createEditor();
const otherEditor = createEditor();
const paragraph = createKeyedNode("p");
setNodeKeyOnDOMNode(paragraph, editor, "root");

const readBack = getNodeKeyFromDOMNode(paragraph, editor);
const readFromOtherEditor = getNodeKeyFromDOMNode(paragraph, otherEditor);
const readFromUntouched = getNodeKeyFromDOMNode(createKeyedNode("p"), editor);

const RewrittenKey = () => {
  const span = createKeyedNode("span");
  setNodeKeyOnDOMNode(span, editor, "first");
  setNodeKeyOnDOMNode(span, editor, "second");
  const beforeDelete = getNodeKeyFromDOMNode(span, editor);
  delete span[`__lexicalKey_${editor.key}`];
  return (
    <p>
      {describeKey(beforeDelete)} {describeKey(getNodeKeyFromDOMNode(span, editor))}
    </p>
  );
};

const ForeignKey = () =>
  readFromOtherEditor === undefined ? <em>foreign-undefined</em> : <b>foreign-defined</b>;

export const isPartial = true;

export default function DynamicExpandoKeys() {
  return (
    <section>
      <output>
        {"= "}
        {describeKey(readBack)}
      </output>
      <output>
        {"= "}
        {describeKey(readFromUntouched)}
      </output>
      <ForeignKey />
      <RewrittenKey />
    </section>
  );
}
