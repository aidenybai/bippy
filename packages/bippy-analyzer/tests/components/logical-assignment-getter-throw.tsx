export default () => {
  const shouldThrow = Math.random() > 0.5;
  let reads = 0;
  let calls = 0;
  let label = "returned";
  const state = {
    get value() {
      reads++;
      if (shouldThrow) throw new Error("failed");
      return "old";
    },
    set value(value: string) {
      calls += value.length;
    },
  };
  const getNext = () => {
    calls++;
    return "new";
  };
  try {
    state.value ||= getNext();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${reads}:${calls}`}
    </main>
  );
};
