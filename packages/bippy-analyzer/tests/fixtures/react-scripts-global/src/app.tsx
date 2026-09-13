declare const global: typeof globalThis;

const SERVER_RENDERED = typeof navigator === "undefined" || typeof global === "undefined";

export const App = () =>
  SERVER_RENDERED ? null : (
    <main>
      <code>{typeof global}</code>
      <code>{String(global === window)}</code>
      <code>{typeof global.setTimeout}</code>
    </main>
  );
