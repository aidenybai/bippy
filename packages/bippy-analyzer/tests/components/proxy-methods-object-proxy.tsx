export default () => {
  let calls = 0;
  const method = new Proxy(
    {},
    {
      apply: () => {
        calls++;
        return "ready";
      },
    },
  );
  const proxy = new Proxy({}, { get: method });
  let label = "returned";
  try {
    proxy.value;
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
