export default () => {
  const state = { value: "old" };
  Object.defineProperty(state, "value", { get: () => "old" });
  let label = "returned";
  try {
    state.value = "new";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${state.value}`}
    </main>
  );
};
