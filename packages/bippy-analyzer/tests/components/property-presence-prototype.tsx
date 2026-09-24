export default () => {
  const target = Object.create({ value: "parent" });
  target.value = undefined;
  if (Math.random() > 0.5) delete target.value;
  return (
    <main>
      <span>Result:</span>
      {`${"value" in target}:${Object.prototype.hasOwnProperty.call(target, "value")}:${String(target.value)}`}
    </main>
  );
};
