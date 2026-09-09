function* accumulate(): Generator<string, string, number> {
  const first = yield "first";
  const second = yield `got ${first}`;
  try {
    const third = yield `sum ${first + second}`;
    return `done ${third}`;
  } finally {
    outcome.finalized = "yes";
  }
}

const outcome: Record<string, string> = {};

const accumulator = accumulate();
const sent = [
  accumulator.next(),
  accumulator.next(1),
  accumulator.next(2),
  accumulator.next(3),
  accumulator.next(4),
];

function* recovering(): Generator<string, string> {
  try {
    yield "before";
  } catch (error) {
    yield `caught ${(error as Error).message}`;
  }
  return "recovered";
}

const recoverer = recovering();
const recovered = [recoverer.next(), recoverer.throw(new Error("thrown in")), recoverer.next()];

const closing = recovering();
closing.next();
const closed = [closing.return("early"), closing.next()];

const asyncHelper = <Result,>(
  self: unknown,
  args: unknown[],
  generator: (...params: unknown[]) => Generator<unknown, Result, unknown>,
): Promise<Result> =>
  new Promise((resolve, reject) => {
    let iterator: Generator<unknown, Result, unknown>;
    const fulfilled = (value: unknown) => {
      try {
        step(iterator.next(value));
      } catch (error) {
        reject(error);
      }
    };
    const rejected = (value: unknown) => {
      try {
        step(iterator.throw(value));
      } catch (error) {
        reject(error);
      }
    };
    const step = (result: IteratorResult<unknown, Result>) =>
      result.done ? resolve(result.value) : Promise.resolve(result.value).then(fulfilled, rejected);
    iterator = generator.apply(self, args);
    step(iterator.next());
  });

const loadGreeting = (name: string) =>
  asyncHelper(null, [name], function* (person: unknown) {
    const greeting = yield Promise.resolve("hello");
    const punctuation = yield "!";
    return `${greeting} ${person}${punctuation}`;
  });

loadGreeting("world").then((greeting) => {
  outcome.greeting = greeting;
});

const describeResult = (result: IteratorResult<unknown, unknown>) =>
  `${String(result.value)}:${result.done}`;

export default function GeneratorContinuations() {
  return (
    <ul>
      <li>sent: {sent.map(describeResult).join(" ")}</li>
      <li>finalized: {outcome.finalized}</li>
      <li>recovered: {recovered.map(describeResult).join(" ")}</li>
      <li>closed: {closed.map(describeResult).join(" ")}</li>
      <li>greeting: {outcome.greeting ?? "pending"}</li>
    </ul>
  );
}
export const isExact = true;
