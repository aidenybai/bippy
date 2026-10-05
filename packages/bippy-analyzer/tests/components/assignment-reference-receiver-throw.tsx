export default () => {
  const shouldThrow = Math.random() > 0.5;
  const state = { value: "old" };
  let order = "";
  let label = "returned";
  const getReceiver = () => {
    order += "B";
    if (shouldThrow) throw new Error("receiver");
    return state;
  };
  const getKey = (): "value" => {
    order += "K";
    return "value";
  };
  const getRight = () => {
    order += "R";
    return "new";
  };
  try {
    getReceiver()[getKey()] = getRight();
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
