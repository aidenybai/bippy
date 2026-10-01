export default () => {
  const source: { value?: string } = {};
  if (Math.random() > 0.5) source.value = "first";
  const copied = { ...source };
  source.value = "later";
  return (
    <main>
      <span>Result:</span>
      {`${"value" in copied}:${String(copied.value)}`}
    </main>
  );
};
