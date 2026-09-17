export default () => {
  const instances: object[] = [];
  class Parent {
    constructor() {
      instances.push(this);
    }
  }
  class Child extends Parent {
    constructor() {
      super();
      try {
        super();
      } catch {}
    }
  }
  const instance = new Child();
  return (
    <main>
      <span>Result:</span>
      {`${instances[0] === instance}:${instances[1] === instance}:${instances[0] === instances[1]}:${instances.length}:${instance instanceof Child}`}
    </main>
  );
};
