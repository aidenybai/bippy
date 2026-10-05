const trace: string[] = [];
export const getTrace = () => trace.slice();

const LoopCleanup = () => {
  const readers: Array<() => number> = [];
  for (let index = 0; index < 3; index++) readers.push(() => index);
  const iterator = {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      trace.push("next");
      return { value: 7, done: false };
    },
    return(): IteratorResult<number> {
      trace.push("close");
      throw "cleanup";
    },
  };
  let result = "";
  try {
    for (const value of iterator) {
      trace.push(`body:${value}`);
      throw "body";
    }
  } catch (error) {
    result = String(error);
  }
  return (
    <output>
      {readers.map((read) => read()).join(",")}:{result}
    </output>
  );
};
export default LoopCleanup;
