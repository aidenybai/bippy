export default () => {
  const target = Math.random() > 0.5 ? { value: "ready" } : null;
  let label = "returned";
  try {
    label = typeof target!.value;
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
