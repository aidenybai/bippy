export default () => {
  const state = { trace: "" };
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  try {
    for (let index = 0; index < 3; index++) {
      state.trace += index;
      if (index === 1 && shouldThrow) throw "block";
    }
    state.trace += "L";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${state.trace}`}
    </main>
  );
};
