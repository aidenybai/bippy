export default () => {
  class First {
    static label = "first";
  }
  class Second {
    static label = "second";
  }
  const Parent = Math.random() > 0.5 ? First : Second;
  let calls = 0;
  class Child extends Parent {
    static ready = ++calls;
  }
  return (
    <main>
      <span>Result:</span>
      {`${Child.label}:${calls}`}
    </main>
  );
};
