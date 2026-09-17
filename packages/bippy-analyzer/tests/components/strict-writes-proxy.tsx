export default () => {
  const proxy = new Proxy({ value: "old" }, { set: () => false });
  let label = "returned";
  try {
    proxy.value = "new";
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
