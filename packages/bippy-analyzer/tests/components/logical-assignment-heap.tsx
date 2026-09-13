export default () => {
  const shouldKeep = Math.random() > 0.5;
  const state = { calls: 0, values: new Array<string>() };
  let value = shouldKeep ? "old" : "";
  const getNext = () => {
    state.calls++;
    state.values.push("new");
    return "new";
  };
  value ||= getNext();
  return (
    <main>
      <span>Result:</span>
      {`${value}:${state.calls}:${state.values.length}`}
    </main>
  );
};
