export default () => {
  let calls = 0;
  const proxy = new Proxy(
    {},
    {
      set: () => {
        calls++;
        return Math.random() > 0.5;
      },
    },
  );
  let label = "returned";
  try {
    proxy.value = "new";
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
