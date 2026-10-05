export default () => {
  let label = "initial";
  const parent = {
    marker: "parent",
    set value(next: string) {
      label = `${this.marker}:${next}`;
    },
  };
  const child = Object.create(parent);
  child.marker = "child";
  child.value = "new";
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
