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
