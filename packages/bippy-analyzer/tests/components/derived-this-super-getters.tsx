export default () => {
  let order = "";
  let observed = "unset";
  const getKey = (): "selected" => {
    order += "K";
    return "selected";
  };
  class Parent {
    value = "old";
    constructor() {
      return { value: "new" };
    }
    get selected() {
      order += "G";
      return this.value;
    }
    get unrelated() {
      order += "X";
      throw new Error("unread getter");
    }
  }
  class Child extends Parent {
    constructor() {
      super();
      observed = super[getKey()];
    }
  }
  new Child();
  return (
    <main>
      <span>Result:</span>
      {`${observed}:${order}`}
    </main>
  );
};
