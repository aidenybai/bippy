export default () => {
  const shouldThrow = Math.random() > 0.5;
  const state = { calls: 0 };
  const run = () => {
    try {
      state.calls++;
      if (shouldThrow) throw new Error("failed");
      state.calls++;
      return "returned";
    } catch {
      return "caught";
    }
  };
  const label = run();
  return (
    <main>
      <span>Result:</span>
      {`${label}:${state.calls}`}
    </main>
  );
};
