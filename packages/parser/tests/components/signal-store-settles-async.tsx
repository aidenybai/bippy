import { useMemo, useState, useSyncExternalStore } from "react";

interface Signal<Value> {
  name: string;
  lastChangedEpoch: number;
  get(): Value;
  getWithoutCapture(): Value;
  children: Set<Effect>;
}

interface Effect {
  name: string;
  run(): void;
}

let globalEpoch = 0;
let capturing: Signal<unknown>[] | null = null;
const pendingEffects = new Set<Effect>();
let transactionDepth = 0;

const flushEffects = () => {
  for (const effect of [...pendingEffects]) {
    pendingEffects.delete(effect);
    effect.run();
  }
};

const transact = (run: () => void) => {
  transactionDepth++;
  try {
    run();
  } finally {
    transactionDepth--;
    if (transactionDepth === 0) flushEffects();
  }
};

const atom = <Value,>(name: string, initial: Value) => {
  let current = initial;
  const signal: Signal<Value> & { set(next: Value): void } = {
    name,
    lastChangedEpoch: globalEpoch,
    children: new Set(),
    getWithoutCapture: () => current,
    get: () => {
      capturing?.push(signal);
      return current;
    },
    set: (next) => {
      if (next === current) return;
      current = next;
      globalEpoch++;
      signal.lastChangedEpoch = globalEpoch;
      for (const child of signal.children) pendingEffects.add(child);
      if (transactionDepth === 0) flushEffects();
    },
  };
  return signal;
};

const computed = <Value,>(name: string, derive: () => Value): Signal<Value> => {
  let lastCheckedEpoch = -1;
  let current: Value;
  const parents = new Set<Signal<unknown>>();
  const signal: Signal<Value> = {
    name,
    lastChangedEpoch: globalEpoch,
    children: new Set(),
    getWithoutCapture: () => {
      if (lastCheckedEpoch === globalEpoch) return current;
      const previousCapture = capturing;
      capturing = [];
      const next = derive();
      for (const parent of capturing) parents.add(parent);
      capturing = previousCapture;
      if (lastCheckedEpoch === -1 || next !== current) signal.lastChangedEpoch = globalEpoch;
      lastCheckedEpoch = globalEpoch;
      current = next;
      return current;
    },
    get: () => {
      const value = signal.getWithoutCapture();
      for (const parent of parents) capturing?.push(parent);
      return value;
    },
  };
  return signal;
};

const react = (name: string, run: () => void) => {
  const parents = new Set<Signal<unknown>>();
  const effect: Effect = {
    name,
    run: () => {
      const previousCapture = capturing;
      capturing = [];
      run();
      for (const parent of capturing) {
        parents.add(parent);
        parent.children.add(effect);
      }
      capturing = previousCapture;
    },
  };
  effect.run();
  return () => {
    for (const parent of parents) parent.children.delete(effect);
  };
};

const useValue = <Value,>(name: string, derive: () => Value, deps: unknown[]): Value => {
  const { $val, subscribe, getSnapshot } = useMemo(() => {
    const $val = computed(name, derive);
    return {
      $val,
      subscribe: (notify: () => void) =>
        react(`useValue(${name})`, () => {
          $val.get();
          notify();
        }),
      getSnapshot: () => $val.lastChangedEpoch,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return $val.getWithoutCapture();
};

type LicenseState = "pending" | "unlicensed" | "licensed";

class LicenseManager {
  state = atom<LicenseState>("license state", "pending");
  features = atom<string[]>("features", []);

  constructor(licenseKey: string | undefined) {
    this.getLicenseFromKey(licenseKey)
      .then((result) => {
        transact(() => {
          this.state.set(result.isParseable ? "licensed" : "unlicensed");
          this.features.set(result.isParseable ? ["export"] : []);
        });
      })
      .catch(() => {
        this.state.set("unlicensed");
      });
  }

  async getLicenseFromKey(licenseKey: string | undefined) {
    if (!licenseKey) return { isParseable: false as const, reason: "no-key" };
    return { isParseable: true as const, key: licenseKey };
  }
}

const Watermark = ({ manager }: { manager: LicenseManager }) => {
  const licenseState = useValue("watermark state", () => manager.state.get(), [manager]);
  if (!["unlicensed"].includes(licenseState)) return null;
  return (
    <>
      <style>{".watermark { opacity: 0.5 }"}</style>
      <a className="watermark" href="https://example.invalid">
        made with a signal
      </a>
    </>
  );
};

export const isExact = true;

export default function SignalStoreSettlesAsync() {
  const [manager] = useState(() => new LicenseManager(undefined));
  const state = useValue("provider state", () => manager.state.get(), [manager]);
  return (
    <main data-state={state}>
      <p>state: {state}</p>
      <Watermark manager={manager} />
    </main>
  );
}
