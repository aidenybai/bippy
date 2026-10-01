export default () => {
  const proxy = new Proxy({}, { get: Math.random() });
  let label = "returned";
  try {
    proxy.value;
  } catch (error) {
    label = error instanceof TypeError ? "type-error" : "other";
  }
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
