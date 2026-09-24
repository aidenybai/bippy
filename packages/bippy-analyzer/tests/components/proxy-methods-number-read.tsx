export default () => {
  const proxy = new Proxy({ value: "ready" }, { get: 123 });
  let label = "returned";
  try {
    proxy.value;
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
