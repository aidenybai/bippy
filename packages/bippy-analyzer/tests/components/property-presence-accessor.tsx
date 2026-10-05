export default () => {
  let label = "old";
  let reads = 0;
  let writes = 0;
  const target = {
    get value() {
      reads++;
      return label;
    },
    set value(next: string) {
      writes++;
      label = next;
    },
  };
  if (Math.random() > 0.5) target.extra = true;
  target.value = "new";
  const value = target.value;
  return (
    <main>
      <span>Result:</span>
      {`${value}:${reads}:${writes}`}
    </main>
  );
};
