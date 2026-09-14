export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let bodies = 0;
  let label = "returned";
  const getFirst = () => {
    calls++;
    if (shouldThrow) throw new Error("first");
    return "first";
  };
  const getSecond = () => {
    calls++;
    return "second";
  };
  class Item {
    value: string;
    constructor(first: string, second: string) {
      bodies++;
      this.value = first + second;
    }
  }
  try {
    new Item(getFirst(), getSecond());
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${calls}:${bodies}`}
    </main>
  );
};
