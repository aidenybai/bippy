export default () => {
  const target = null;
  let label = "returned";
  try {
    delete target!.value;
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
