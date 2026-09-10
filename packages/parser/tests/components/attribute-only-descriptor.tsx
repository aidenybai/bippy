import { Component, useState, type ReactNode } from "react";

interface Mutable {
  value: number;
  get(): number;
  set(next: number): void;
}

const makeMutable = (initial: number): Mutable => {
  let value = initial;
  const mutable: Mutable = {
    get value() {
      return value;
    },
    set value(next: number) {
      value = next;
    },
    get() {
      return mutable.value;
    },
    set(next: number) {
      mutable.value = next;
    },
  };
  Object.defineProperties(mutable, {
    get: { configurable: false, enumerable: false, writable: false },
    set: { configurable: false, enumerable: false, writable: false },
  });
  return mutable;
};

const useSharedValue = (initial: number): Mutable => {
  const [mutable] = useState(() => makeMutable(initial));
  return mutable;
};

const checkSharedValueUsage = (prop: unknown, currentKey: string | undefined): void => {
  if (Array.isArray(prop)) {
    for (const element of prop) checkSharedValueUsage(element, currentKey);
  } else if (typeof prop === "object" && prop !== null && !("value" in prop)) {
    for (const key of Object.keys(prop)) {
      checkSharedValueUsage(Reflect.get(prop, key), key);
    }
  } else if (currentKey !== undefined && typeof prop === "object" && prop !== null) {
    throw new Error(
      `Invalid value passed to \`${currentKey}\`, maybe you forgot to use \`.value\`?`,
    );
  }
};

class Boundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? <p>crashed</p> : this.props.children;
  }
}

const Sheet = () => {
  const translateY = useSharedValue(0);
  const style = { transform: [{ translateY: translateY.get() }] };
  checkSharedValueUsage(style, undefined);
  return (
    <section
      data-keys={Object.keys(translateY).join(",")}
      style={{ transform: `translateY(${style.transform[0].translateY}px)` }}
    >
      sheet
    </section>
  );
};

export const isExact = true;

export default function AttributeOnlyDescriptor() {
  return (
    <Boundary>
      <Sheet />
    </Boundary>
  );
}
