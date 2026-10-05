import { useState } from "react";

const URL_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const DEFAULT_ID_SIZE = 21;
const UUID_LENGTH = 36;

const createId = (size = DEFAULT_ID_SIZE): string => {
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  while (size--) id += URL_ALPHABET[bytes[size] & 63];
  return id;
};

interface GraphNode {
  id: string;
  label: string;
}

const createNodes = (): GraphNode[] => [
  { id: createId(), label: "start" },
  { id: createId(), label: "end" },
];

export const App = () => {
  const [nodes] = useState(createNodes);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [uuid] = useState(() => crypto.randomUUID());
  const firstByte = crypto.getRandomValues(new Uint8Array(1))[0];
  const selectedIndex = nodes.findIndex((node) => node.id === selectedId);
  return (
    <main>
      <ul>
        {nodes.map((node) => (
          <li key={node.label} onClick={() => setSelectedId(node.id)}>
            {typeof node.id === "string" ? <b>{node.label}</b> : <i>missing</i>}
            {node.id === undefined || node.id === null ? <s>empty</s> : <em>ready</em>}
            {node.id === 0 ? <s>zero</s> : <span>text</span>}
          </li>
        ))}
      </ul>
      {selectedIndex === -1 ? <p>nothing selected</p> : <output>{selectedIndex}</output>}
      {typeof uuid === "string" && uuid.length === UUID_LENGTH ? <code>uuid</code> : <s>uuid</s>}
      {typeof firstByte === "number" ? <kbd>byte</kbd> : <s>byte</s>}
    </main>
  );
};
