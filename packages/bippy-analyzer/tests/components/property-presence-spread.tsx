export default () => {
  const source = Math.random() > 0.5 ? { value: undefined } : {};
  const target = { value: "old", ...source };
  return (
    <main>
      <span>Result:</span>
      {`${Object.prototype.hasOwnProperty.call(target, "value")}:${String(target.value)}`}
    </main>
  );
};
