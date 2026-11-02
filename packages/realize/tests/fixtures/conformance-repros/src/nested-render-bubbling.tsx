import { useMemo, useState } from "react";

export const ButtonInMappedPair = ({ rows }: { rows: string[] }) => {
  const [isInner, setIsInner] = useState(false);
  const [isOuter, setIsOuter] = useState(false);
  return (
    <dl onClick={() => setIsOuter(true)}>
      {rows.map((row) => [
        <dt key={`${row}-term`}>{row}</dt>,
        <dd key={`${row}-detail`}>
          <button onClick={() => setIsInner(true)}>go</button>
        </dd>,
      ])}
      {isInner && isOuter ? <i>both</i> : <i>apart</i>}
    </dl>
  );
};

export const ButtonInStaleMemo = () => {
  const [isInner, setIsInner] = useState(false);
  const [isOuter, setIsOuter] = useState(false);
  const goButton = useMemo(
    () => <button onClick={() => setIsInner(true)}>{isInner ? "went" : "go"}</button>,
    [],
  );
  return (
    <div onClick={() => setIsOuter(true)}>
      {goButton}
      {isInner && isOuter ? <i>both</i> : <i>apart</i>}
    </div>
  );
};
