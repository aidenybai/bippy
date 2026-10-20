import { useState } from "react";

type PartKind = "fab" | "extendedFab" | "splitButton";
type FabKind = "fab" | "extendedFab";

declare function isFab(kind: PartKind): boolean;
declare function FabTypeRow(props: { value: FabKind }): null;

export const PartInspector = ({ item }: { item: { kind: PartKind } }) => {
  const [tab, setTab] = useState<"design" | "code">("design");
  const fab = isFab(item.kind);
  return (
    <div>
      {tab === "design" && fab ? <FabTypeRow value={item.kind as FabKind} /> : null}
      {item.kind === "splitButton" ? <p>split</p> : null}
      <button onClick={() => setTab(tab === "design" ? "code" : "design")}>{tab}</button>
    </div>
  );
};

export const PlainInspector = ({ item }: { item: { kind: PartKind } }) => {
  const [isOpen, setOpen] = useState(false);
  return (
    <div>
      {item.kind === "splitButton" ? <FabTypeRow value={item.kind as FabKind} /> : null}
      <button onClick={() => setOpen(!isOpen)}>{isOpen ? "Hide" : "Show"}</button>
    </div>
  );
};
