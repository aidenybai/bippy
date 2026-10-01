export default () => {
  let calls = 0;
  const target = { value: "old" };
  const proxy = new Proxy(target, {
    set(innerTarget, key, value) {
      calls++;
      innerTarget[key] = value;
      return false;
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
      {`${label}:${target.value}:${calls}`}
    </main>
  );
};
