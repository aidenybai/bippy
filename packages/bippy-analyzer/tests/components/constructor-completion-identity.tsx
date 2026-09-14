export default () => {
  const replacement = { value: "new" };
  let original: { value: string } | null = null;
  class Item {
    value = "old";
    constructor() {
      original = this;
      return replacement;
    }
  }
  const instance = new Item();
  return (
    <main>
      <span>Result:</span>
      {`${instance === replacement}:${original === replacement}:${instance.value}`}
    </main>
  );
};
