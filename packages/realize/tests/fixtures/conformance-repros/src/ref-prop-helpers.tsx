import { useCallback, type Ref } from "react";

const assignRef = <T,>(ref: Ref<T> | undefined, value: T | null): void => {
  if (typeof ref === "function") ref(value);
  else if (ref != null) ref.current = value;
};

export const ForwardedBox = ({ boxRef }: { boxRef?: Ref<HTMLDivElement> }) => {
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      assignRef(boxRef, node);
    },
    [boxRef],
  );
  return <div ref={attach} />;
};

export const ConfigEditor = ({ config }: { config: { name: string } }) => {
  const rename = (target: { name: string }) => {
    target.name = "next";
  };
  return <button onClick={() => rename(config)}>{config.name}</button>;
};
