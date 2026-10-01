export default () => {
  const state = new Proxy(
    { value: "old" },
    {
      set: () => {
        throw new Error("setter");
      },
    },
  );
  let calls = 0;
  let label = "returned";
  const getNext = () => {
    calls++;
    return "new";
  };
  try {
    state.value = getNext();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${calls}`}
    </main>
  );
};
