export default () => {
  const target = { value: undefined };
  if (Math.random() > 0.5) delete target.value;
  const own = Object.prototype.hasOwnProperty.call(target, "value");
  return (
    <main>
      <span>Result:</span>
      {`${"value" in target}:${own}:${String(target.value)}`}
    </main>
  );
};
