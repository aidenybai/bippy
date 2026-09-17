import { useLayoutEffect, useState } from "react";
import { EventEmitter } from "./shared/node-events";

interface CellResult {
  name: string;
  value: string | null;
}

interface CellBinding {
  name: string;
  query: string | null;
}

const cache = new Map<string, string>([["balance", "1,200"]]);
const observers = new EventEmitter();

/** Actual Budget's spreadsheet `bind`: register the observer, then answer synchronously from the cache. */
const bind = (name: string, onChange: (result: CellResult) => void) => {
  observers.on(name, onChange);
  const cached = cache.get(name);
  if (cached !== undefined) onChange({ name, value: cached });
  return () => {
    observers.off(name, onChange);
  };
};

/** The binding is rebuilt on every render, so the layout effect re-subscribes after each commit. */
const useCellValue = (name: string) => {
  const [result, setResult] = useState<CellResult>({ name, value: null });
  const binding: CellBinding = { name, query: null };
  useLayoutEffect(() => {
    let isMounted = true;
    const unbind = bind(binding.name, (next) => {
      if (isMounted && next.value !== result.value) setResult(next);
    });
    return () => {
      isMounted = false;
      unbind();
    };
  }, [binding]);
  return result.value;
};

const Cell = ({ name }: { name: string }) => {
  const value = useCellValue(name);
  return (
    <output
      data-cell={name}
      onClick={() => {
        void navigator.clipboard.writeText(value ?? "");
      }}
    >
      <span />
    </output>
  );
};

export default function EscapedSubscriptions() {
  return (
    <dl>
      <dt>balance</dt>
      <dd>
        <Cell name="balance" />
      </dd>
      <dt>missing</dt>
      <dd>
        <Cell name="missing" />
      </dd>
    </dl>
  );
}
