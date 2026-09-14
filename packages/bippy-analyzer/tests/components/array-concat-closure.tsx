export default () => {
  const values = Math.random() > 0.5 ? ["root"] : ["root", "child"];
  const combined = values.concat(values);
  return (
    <main>
      <span>Values:</span>
      {combined.join(",")}
    </main>
  );
};
