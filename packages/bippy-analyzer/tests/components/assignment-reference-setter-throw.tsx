export default () => {
  const shouldThrow = Math.random() > 0.5;
  let value = "old";
  let calls = 0;
  let label = "returned";
  const state = {
    get value() {
      return value;
    },
    set value(next: string) {
      calls++;
      if (shouldThrow) throw new Error("setter");
      value = next;
    },
  };
  try {
    state.value = "new";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${value}:${calls}`}
    </main>
  );
};
