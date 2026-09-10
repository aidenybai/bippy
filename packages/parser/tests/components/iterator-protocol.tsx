export const isExact = true;

interface StepwiseIteratorConfig<State, Value> {
  initial: State | null;
  hasNext: (state: State | null) => state is State;
  step: (state: State) => State | null;
  map: (state: State) => Value;
}

const makeStepwiseIterator = <State, Value>(
  config: StepwiseIteratorConfig<State, Value>,
): IterableIterator<Value> => {
  const { initial, hasNext, step, map } = config;
  let state = initial;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next(): IteratorResult<Value> {
      if (!hasNext(state)) return { done: true, value: undefined };
      const result = { done: false, value: map(state) };
      state = step(state);
      return result;
    },
  };
};

interface Cell {
  label: string;
  next: Cell | null;
}

class CellRange {
  constructor(
    readonly anchor: Cell,
    readonly focus: Cell,
  ) {}

  iterCells(): IterableIterator<Cell> {
    const step = (state: Cell) => (state === this.focus ? null : state.next);
    return makeStepwiseIterator({
      hasNext: (state: Cell | null): state is Cell => state !== null,
      initial: this.anchor === this.focus ? null : this.anchor,
      map: (state) => state,
      step,
    });
  }

  [Symbol.iterator]() {
    return this.iterCells();
  }
}

class Countdown {
  constructor(private readonly start: number) {}

  *[Symbol.iterator]() {
    for (let value = this.start; value > 0; value--) yield value;
  }
}

const cells = ["a", "b", "c", "d"].reduceRight<Cell | null>(
  (next, label) => ({ label, next }),
  null,
);
const last = (cell: Cell): Cell => (cell.next ? last(cell.next) : cell);

export default function IteratorProtocol() {
  if (!cells) return null;
  const range = new CellRange(cells, last(cells));
  const collapsed = new CellRange(cells, cells);
  const forOf: string[] = [];
  for (const cell of range) forOf.push(cell.label);
  const spread = [...range].map((cell) => cell.label);
  const fromIterable = Array.from(range, (cell) => cell.label.toUpperCase());
  const [first, second, ...rest] = range;
  const labels = new Set(new CellRange(cells, last(cells))).size;
  const pairs = new Map(
    Array.from(range, (cell): [string, number] => [cell.label, cell.label.charCodeAt(0)]),
  );
  return (
    <section>
      <output>{forOf.join("")}</output>
      <output>{spread.join("")}</output>
      <output>{fromIterable.join("")}</output>
      <output>
        {first.label}
        {second.label}
        {rest.length}
      </output>
      <output>{[...collapsed].length}</output>
      <output>{labels}</output>
      <output>{pairs.get("c")}</output>
      <output>{[...new Countdown(3)].join("-")}</output>
    </section>
  );
}
