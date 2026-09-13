export default () => {
  const shouldThrow = Math.random() > 0.5;
  const state = { value: "old" };
  let order = "";
  let label = "returned";
  const getKey = () => {
    order += "K";
    if (shouldThrow) throw new Error("failed");
    return "value";
  };
  const getNext = () => {
    order += "R";
    return "new";
  };
  try {
    state[getKey()] = getNext();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${order}:${state.value}`}
    </main>
  );
};
