export default () => {
  const target: { value?: string } = {};
  if (Math.random() > 0.5) target.value = "new";
  return (
    <main>
      <span>Result:</span>
      {`${"value" in target}:${Object.prototype.hasOwnProperty.call(target, "value")}:${String(target.value)}`}
    </main>
  );
};
