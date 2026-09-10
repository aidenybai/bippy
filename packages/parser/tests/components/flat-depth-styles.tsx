import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

const SelectedValueContext = createContext<string | null>(null);

type StyleInput = CSSProperties | false | null | undefined | StyleInput[];

const flattenStyles = (...styles: StyleInput[]): CSSProperties => {
  const flatArray = styles.flat(Infinity);
  const result: CSSProperties = {};
  for (const style of flatArray) {
    if (style != null && typeof style === "object") Object.assign(result, style);
  }
  return result;
};

const web = (style: CSSProperties): StyleInput[] => [style];

const Item = ({ value, style }: { value: string; style: StyleInput }) => {
  const isSelected = useContext(SelectedValueContext) === value;
  const flattened = flattenStyles([
    { display: "flex", minHeight: 25 },
    isSelected && [{ fontWeight: 600 }],
    style,
  ]);
  return (
    <li style={flattened}>
      {flattened.fontWeight ? <b>{value}</b> : value} ({String(flattened.fontWeight)},{" "}
      {flattened.cursor})
    </li>
  );
};

const Select = ({ children }: { children: ReactNode }) => (
  <SelectedValueContext.Provider value={Math.random() < 0.5 ? "first" : "second"}>
    {children}
  </SelectedValueContext.Provider>
);

const depthOne = [[1, [2]], 3].flat();
const depthTwo = [[1, [2, [3]]]].flat(2);
const depthZero = [[1]].flat(0);

export const isPartial = true;

export default function FlatDepthStyles() {
  return (
    <ul>
      <li>
        {depthOne.length} / {depthTwo.length} / {depthZero.length}
      </li>
      <Select>
        <Item value="first" style={[web({ cursor: "pointer" }), { color: "#000" }]} />
        <Item value="second" style={web({ cursor: "default" })} />
      </Select>
    </ul>
  );
}
