/**
 * `Function.prototype.toString` of a program function is the text the bundler
 * served (types stripped, whitespace reprinted), so a key built from it is an
 * unknown string the runtime decides; intrinsics keep their `[native code]` text.
 * Two closures of one function expression read back the same text, which is how
 * Floating UI's `deepEqual` recognizes freshly built middleware as unchanged.
 */
import { useEffect, useState } from "react";

interface Cell {
  id: string;
  getValue: () => number;
}

const cells: Cell[] = [
  { id: "0_amount", getValue: (): number => 1 },
  { id: "1_amount", getValue: (): number => 2 },
];

class Reducer {
  total = 0;
}

interface Middleware {
  name: string;
  fn: (state: number) => number;
}

const offset = (amount: number): Middleware => ({ name: "offset", fn: (state) => state + amount });

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (typeof left === "function" && typeof right === "function")
    return left.toString() === right.toString();
  if (left && right && typeof left === "object" && typeof right === "object") {
    if (Array.isArray(left)) {
      if (!Array.isArray(right) || left.length !== right.length) return false;
      return left.every((item, index) => deepEqual(item, right[index]));
    }
    const leftRecord: Record<string, unknown> = { ...left };
    const rightRecord: Record<string, unknown> = { ...right };
    const keys = Object.keys(leftRecord);
    if (keys.length !== Object.keys(rightRecord).length) return false;
    return keys.every((key) => deepEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
};

const Positioned = ({ middleware }: { middleware: Middleware[] }) => {
  const [latestMiddleware, setLatestMiddleware] = useState(middleware);
  if (!deepEqual(latestMiddleware, middleware)) setLatestMiddleware(middleware);
  return <span>offsets {latestMiddleware.map((entry) => entry.fn(0)).join(",")}</span>;
};

const Tooltip = () => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  return <Positioned middleware={[offset(isMounted ? 4 : 0), offset(8)]} />;
};

const Row = ({ cell }: { cell: Cell }) => (
  <td>
    {cell.getValue()}
    {typeof cell.getValue.toString()}
  </td>
);

export default function FunctionSourceText() {
  return (
    <table>
      <tbody>
        <tr>
          {cells.map((cell) => (
            <Row key={cell.id + cell.getValue?.toString()} cell={cell} />
          ))}
          <td key={String(Reducer)}>{typeof Reducer.toString()}</td>
          <td>{Function.prototype.toString.call(Math.max)}</td>
          <td>
            <Tooltip />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export const isExact = true;
