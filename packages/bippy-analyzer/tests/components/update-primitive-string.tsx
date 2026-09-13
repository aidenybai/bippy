export default () => {
  const state = { value: JSON.parse('"1"') };
  const previous = state.value++;
  return (
    <main>
      <span>Result:</span>
      {`${typeof previous}:${previous}:${state.value}`}
    </main>
  );
};
