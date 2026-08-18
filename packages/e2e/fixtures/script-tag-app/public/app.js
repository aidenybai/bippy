// Classic script using UMD globals: no bundler, no JSX transform. bippy
// was installed by the preceding script tag before React loaded.
(function runScriptTagApp() {
  window.__BIPPY__ = Bippy;
  window.__COMMIT_COUNT__ = 0;
  Bippy.instrument({
    onCommitFiberRoot: function onCommitFiberRoot() {
      window.__COMMIT_COUNT__++;
    },
  });

  const createElement = React.createElement;

  function Counter() {
    const countState = React.useState(0);
    const count = countState[0];
    const setCount = countState[1];
    return createElement(
      "button",
      {
        "data-testid": "increment",
        onClick: function handleClick() {
          setCount(count + 1);
        },
      },
      "count:" + count,
    );
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(createElement("div", { "data-testid": "test-child" }, createElement(Counter)));
})();
