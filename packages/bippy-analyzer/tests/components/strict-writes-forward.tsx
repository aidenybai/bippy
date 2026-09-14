export default () => {
  const target = {
    get value() {
      return "old";
    },
  };
  const proxy = new Proxy(new Proxy(target, {}), { set: null });
  let label = "returned";
  try {
    proxy.value = "new";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${proxy.value}`}
    </main>
  );
};
