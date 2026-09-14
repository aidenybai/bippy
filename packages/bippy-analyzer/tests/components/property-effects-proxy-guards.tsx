export default () => {
  const shouldThrow = Math.random() > 0.5;
  const data = { value: "old" };
  let calls = 0;
  const proxy = new Proxy(data, {
    set(target, key, value) {
      calls++;
      if (shouldThrow) throw new Error("setter");
      target[key] = value;
      return true;
    },
  });
  let label = "returned";
  try {
    proxy.value = "new";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${data.value}:${calls}`}
    </main>
  );
};
