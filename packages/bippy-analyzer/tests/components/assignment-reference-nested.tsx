export default () => {
  const state = { value: 1 };
  let reads = 0;
  const holder = {
    get target() {
      reads++;
      return state;
    },
  };
  holder.target.value += 2;
  return (
    <main>
      <span>Result:</span>
      {`${reads}:${state.value}`}
    </main>
  );
};
