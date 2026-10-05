export default () => {
  const proxy = new Proxy({}, { set: () => 0 });
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
