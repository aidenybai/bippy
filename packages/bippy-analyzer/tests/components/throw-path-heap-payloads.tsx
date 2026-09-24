export default () => {
  const mode = Math.floor(Math.random() * 3);
  const state = { calls: 0 };
  let label = "returned";
  const run = () => {
    state.calls++;
    if (mode === 0) throw "first";
    state.calls++;
    if (mode === 1) throw "second";
    state.calls++;
    return "done";
  };
  try {
    run();
  } catch (error) {
    label = String(error);
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${state.calls}`}
    </main>
  );
};
