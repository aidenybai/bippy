export default () => {
  const parent = {
    marker: "parent",
    get value() {
      return this.marker;
    },
  };
  const child = Object.create(parent);
  child.marker = "child";
  return (
    <main>
      <span>Result:</span>
      {child.value}
    </main>
  );
};
