export default () => {
  const first = { value: "old" };
  const second = { value: "old" };
  let receiver = first;
  const getRight = () => {
    receiver = second;
    return "new";
  };
  receiver.value = getRight();
  const state = { first: "old", second: "old" };
  let key: "first" | "second" = "first";
  const getNext = () => {
    key = "second";
    return "new";
  };
  state[key] = getNext();
  return (
    <main>
      <span>Result:</span>
      {`${first.value}:${second.value}:${receiver === second}|${state.first}:${state.second}:${key}`}
    </main>
  );
};
