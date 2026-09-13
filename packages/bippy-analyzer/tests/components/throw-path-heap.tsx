export default () => {
  const shouldThrow = Math.random() > 0.5;
  const state = { calls: 0 };
  let label = "returned";
  try {
    state.calls++;
    if (shouldThrow) throw new Error("failed");
    state.calls++;
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${state.calls}`}
    </main>
  );
};
