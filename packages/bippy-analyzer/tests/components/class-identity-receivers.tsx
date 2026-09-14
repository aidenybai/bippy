export default () => {
  class Item {
    value = "instance";
    static value = "class";
    read() {
      return this === undefined ? "unbound" : this.value;
    }
    static read() {
      return this === undefined ? "unbound" : this.value;
    }
    arrow = () => this.value;
    static arrow = () => this.value;
  }
  const instance = new Item();
  const read = instance.read;
  const readStatic = Item.read;
  const arrow = instance.arrow;
  const staticArrow = Item.arrow;
  const other = { value: "other" };
  return (
    <main>
      <span>Result:</span>
      {`${read()}:${readStatic()}:${read.call(other)}:${arrow.call(other)}:${staticArrow.call(other)}`}
    </main>
  );
};
