export default () => {
  const proxy = new Proxy({ value: "ready" }, { get: null });
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
