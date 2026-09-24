export default () => {
  const accepts = Math.random() > 0.5;
  const proxy = new Proxy({}, { set: () => accepts });
  let label = "returned";
  try {
    proxy.value = "new";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${accepts ? "true" : "false"}:${label}`}
    </main>
  );
};
