export default () => {
  let previous: { id: number } | null = null;
  let fields = 0;
  let calls = 0;
  class Parent {
    id = ++fields;
    constructor() {
      calls++;
      if (calls === 1) {
        previous = this;
        Object.freeze(this);
        throw new Error("retry");
      }
    }
  }
  class Child extends Parent {
    constructor() {
      try {
        super();
      } catch {
        super();
      }
    }
  }
  const instance = new Child();
  return (
    <main>
      <span>Result:</span>
      {`${previous?.id}:${instance.id}:${previous === instance}:${Object.isFrozen(previous)}:${Object.isFrozen(instance)}`}
    </main>
  );
};
