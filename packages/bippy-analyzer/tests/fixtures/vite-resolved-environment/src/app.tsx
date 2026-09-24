import channel from "environment-branch";

const App = () => {
  const environment = import.meta.env;
  return (
    <main>
      {environment.PROD ? <strong /> : <span />}
      {environment.DEV ? <em /> : <u />}
      {environment.SSR ? <dl /> : <ol />}
      keys: {Object.keys(environment).join(",")}
      node: {process.env.NODE_ENV}
      channel: {channel}
      mode: {environment.MODE}
      file: {environment.VITE_MESSAGE}
      prefix: {environment.PUBLIC_MESSAGE}
      define: {environment.DEFINED}
      object: {environment.OBJECT.nested}
      {environment.OBJECT.nullable === null ? <i /> : <b />}
      {environment.PRIVATE_MESSAGE === undefined ? <aside /> : <footer />}
      {environment.VITE_MISSING === undefined ? <nav /> : <section />}
    </main>
  );
};

export default App;
