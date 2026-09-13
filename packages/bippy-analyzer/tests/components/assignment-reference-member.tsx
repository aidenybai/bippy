export default () => {
  const shouldThrow = Math.random() > 0.5;
  const state = { value: "old" };
  let order = "";
  let label = "returned";
  const getTarget = () => {
    order += "L";
    return state;
  };
  const getNext = () => {
    order += "R";
    if (shouldThrow) throw new Error("failed");
    return "new";
  };
  try {
    getTarget().value = getNext();
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
