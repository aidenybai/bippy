export default () => {
  const run = (serialized: string) => {
    const state = { value: JSON.parse(serialized) };
    const previous = state.value++;
    return `${typeof previous}:${previous}:${state.value}`;
  };
  const state = { value: JSON.parse("{}").missing };
  const previous = state.value++;
  return (
    <main>
      <span>Result:</span>
      {`${run("null")}|${run("true")}|${run("false")}|${run('" "')}|${typeof previous}:${previous}:${state.value}`}
    </main>
  );
};
