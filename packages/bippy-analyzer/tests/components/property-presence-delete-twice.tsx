export default () => {
  const target = { value: "old" };
  if (Math.random() > 0.5) delete target.value;
  if (Math.random() > 0.5) delete target.value;
  return (
    <main>
      <span>Result:</span>
      {`${"value" in target}:${String(target.value)}`}
    </main>
  );
};
