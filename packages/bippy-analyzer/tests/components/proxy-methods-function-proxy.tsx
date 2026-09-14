export default () => {
  const method = new Proxy(() => "original", { apply: () => "ready" });
  const proxy = new Proxy({}, { get: method });
  return (
    <main>
      <span>Result:</span>
      {proxy.value}
    </main>
  );
};
