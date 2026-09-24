export default () => {
  const target = { value: "old" };
  const proxy = new Proxy(target, { set: 123 });
  let label = "returned";
  try {
    proxy.value = "new";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${target.value}`}
    </main>
  );
};
