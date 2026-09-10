import { useEffect, useState } from "react";
import { EventEmitter } from "./shared/node-events";

const feed = new EventEmitter();

export const isPartial = true;
export const stateCount = 4;

/** A setter handed straight to code the analysis does not follow may be called with any value. */
export default function EscapedSetterArguments() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    feed.on("count", setCount);
    return () => {
      feed.off("count", setCount);
    };
  }, []);
  if (count === undefined) return <i>cleared</i>;
  return count > 0 ? <b>positive</b> : <s>other</s>;
}
