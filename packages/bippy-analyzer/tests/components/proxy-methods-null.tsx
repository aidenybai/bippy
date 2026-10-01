export default () => {
  const target = { value: "old" };
  const proxy = new Proxy(target, { get: null, set: null });
  proxy.value = "new";
  return (
    <main>
      <span>Result:</span>
      {proxy.value}
    </main>
  );
};
