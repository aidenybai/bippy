import { useState } from "react";

type Kind = "fab" | "extendedFab" | "chip";
type FabKind = "fab" | "extendedFab";

const FabRow = ({ value }: { value: FabKind }) => <p>{value}</p>;

export const KindSwitch = () => {
  const [kind, setKind] = useState<Kind>("chip");
  const isFab = kind === "fab" || kind === "extendedFab";
  return (
    <div>
      <button onClick={() => setKind("fab")}>FAB</button>
      <button onClick={() => setKind("extendedFab")}>Extended</button>
      {isFab ? <FabRow value={kind as FabKind} /> : <p>Chip</p>}
      {kind !== "chip" && !isFab ? <p>Unreachable</p> : null}
    </div>
  );
};

declare const readSearch: () => any;

export const SearchPanel = () => {
  const search = readSearch();
  const [isFocused, setIsFocused] = useState(false);
  const [count, setCount] = useState(0);
  const isOpen = isFocused && search.enoughChars;
  return (
    <div>
      <input onFocus={() => setIsFocused(true)} />
      <button onClick={() => setCount(count + 1)}>{count}</button>
      {isOpen ? <ul /> : null}
    </div>
  );
};
