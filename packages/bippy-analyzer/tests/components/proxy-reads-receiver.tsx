export default () => {
  const proxy = new Proxy(
    { value: "target" },
    {
      marker: "handler",
      get(target, key) {
        return this.marker;
      },
    },
  );
  let label = "initial";
  try {
    label = proxy.value;
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
