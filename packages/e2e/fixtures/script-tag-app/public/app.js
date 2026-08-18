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

  var createElement = React.createElement;

  function Counter() {
    var countState = React.useState(0);
    var count = countState[0];
    var setCount = countState[1];
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

  var root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(
    createElement("div", { "data-testid": "test-child" }, createElement(Counter)),
  );
})();
