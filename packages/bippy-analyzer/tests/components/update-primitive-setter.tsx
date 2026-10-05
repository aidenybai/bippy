export default () => {
  const shouldThrow = Math.random() > 0.5;
  let backing = JSON.parse('"1"');
  let label = "returned";
  let result = "none";
  const state = {
    get value() {
      return backing;
    },
    set value(next) {
      if (shouldThrow) throw new Error("setter");
      backing = next;
    },
  };
  try {
    result = String(state.value++);
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${typeof backing}:${backing}:${result}`}
    </main>
  );
};
