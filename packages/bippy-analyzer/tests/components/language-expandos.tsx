interface ObservableSymbolHost {
  iterator: symbol;
  observable?: symbol;
}

interface WrappedPromise {
  all: unknown;
  spy?: string;
}

const getObservableKey = (): symbol | string => {
  const symbolHost: ObservableSymbolHost = Symbol;
  if (typeof Symbol !== "function") return "@@observable";
  return symbolHost.observable ?? (symbolHost.observable = Symbol("observable"));
};

export default function LanguageExpandos() {
  const observableKey = getObservableKey();
  const store = {
    getState: () => "ready",
    [observableKey]: () => "observable",
  };
  const symbolHost: ObservableSymbolHost = Symbol;
  const promiseHost: WrappedPromise = Promise;
  promiseHost.spy = "installed";
  return (
    <ul>
      <li>{store.getState()}</li>
      <li>{store[observableKey]()}</li>
      <li>{typeof observableKey}</li>
      <li>{String(symbolHost.observable === observableKey)}</li>
      <li>{String("observable" in Symbol)}</li>
      <li>{promiseHost.spy}</li>
      <li>{String("nope" in Math)}</li>
    </ul>
  );
}

export const isExact = true;
