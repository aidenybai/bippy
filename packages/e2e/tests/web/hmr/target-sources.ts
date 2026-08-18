// Source versions written into fixtures/hmr-app/src/target.tsx during the
// HMR specs. Each pair exercises a Fast Refresh semantic from React's
// integration suite (state preservation, signature-driven remounts,
// effect resets) through the real @vitejs/plugin-react pipeline.

export const INITIAL_TARGET_SOURCE = `// Overwritten by tests/web/hmr specs at runtime and restored afterwards.
// Keep in sync with INITIAL_TARGET_SOURCE in tests/web/hmr/target-sources.ts.
import { useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="v1" onClick={() => setCount(count + 1)}>
      v1:{count}
    </button>
  );
};
`;

export const counterSource = (version: string): string => `import { useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="${version}" onClick={() => setCount(count + 1)}>
      ${version}:{count}
    </button>
  );
};
`;

export const renamedStateVariableSource = (
  version: string,
): string => `import { useState } from "react";

export const Target = () => {
  const [total, setTotal] = useState(0);
  return (
    <button data-testid="target" data-version="${version}" onClick={() => setTotal(total + 1)}>
      ${version}:{total}
    </button>
  );
};
`;

export const extraHookSource = (version: string): string => `import { useState } from "react";

export const Target = () => {
  const [label] = useState("extra");
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="${version}" onClick={() => setCount(count + 1)}>
      ${version}:{count}:{label}
    </button>
  );
};
`;

export const effectLoggingSource = (
  version: string,
): string => `import { useEffect, useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    window.__HMR_EFFECT_LOG__.push("mount ${version}");
    return () => {
      window.__HMR_EFFECT_LOG__.push("unmount ${version}");
    };
  }, []);
  return (
    <button data-testid="target" data-version="${version}" onClick={() => setCount(count + 1)}>
      ${version}:{count}
    </button>
  );
};
`;

export const customHookSource = (version: string, hookOrderSwapped: boolean): string => {
  const hookBody = hookOrderSwapped
    ? `const [flag] = useState(true);
  const [count, setCount] = useState(0);`
    : `const [count, setCount] = useState(0);
  const [flag] = useState(true);`;
  return `import { useState } from "react";

const useCounter = () => {
  ${hookBody}
  return { count, setCount, flag };
};

export const Target = () => {
  const { count, setCount } = useCounter();
  return (
    <button data-testid="target" data-version="${version}" onClick={() => setCount(count + 1)}>
      ${version}:{count}
    </button>
  );
};
`;
};

export const refreshResetSource = (version: string): string => `import { useState } from "react";

/* @refresh reset */

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="${version}" onClick={() => setCount(count + 1)}>
      ${version}:{count}
    </button>
  );
};
`;

export const classComponentSource = (version: string): string => `import { Component } from "react";

interface TargetState {
  count: number;
}

export class Target extends Component<object, TargetState> {
  override state: TargetState = { count: 0 };
  override render() {
    return (
      <button
        data-testid="target"
        data-version="${version}"
        onClick={() => this.setState((previous) => ({ count: previous.count + 1 }))}
      >
        ${version}:{this.state.count}
      </button>
    );
  }
}
`;

export const syntaxErrorSource = `import { useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="broken" onClick={() => setCount(count + 1)}>
      {count
    </button>
  );
};
`;
