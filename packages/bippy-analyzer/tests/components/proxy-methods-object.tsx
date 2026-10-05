export default () => {
  let calls = 0;
  const proxy = new Proxy(
    {},
    {
      get: {
        call: () => {
          calls++;
        },
      },
    },
  );
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
