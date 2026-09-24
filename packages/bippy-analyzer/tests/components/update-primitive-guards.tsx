export default () => {
  const useFirst = Math.random() > 0.5;
  const inputs = JSON.parse('["1","4"]');
  const state = { value: useFirst ? inputs[0] : inputs[1] };
  const previous = state.value++;
  return (
    <main>
      <span>Result:</span>
      {`${useFirst ? "first" : "later"}:${typeof previous}:${previous}:${state.value}`}
    </main>
  );
};
