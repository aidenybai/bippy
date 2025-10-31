import '../index.js'; // KEEP THIS LINE ON TOP

import { expect, it, vi } from 'vitest';
import type { FiberRoot } from '../types.js';
import {
  getRDTHook,
  instrument,
  isInstrumentationActive,
  secure,
} from '../index.js';
import React from 'react';
import { render } from '@testing-library/react';

export const Example = () => {
  return <div>Hello</div>;
};

export const ExampleWithEffect = () => {
  React.useEffect(() => {}, []);
  return <div>Hello</div>;
};

it('should not fail if __REACT_DEVTOOLS_GLOBAL_HOOK__ exists already', () => {
  render(<Example />);
  const onCommitFiberRoot = vi.fn();
  instrument(
    secure({ onCommitFiberRoot }, { dangerouslyRunInProduction: true }),
  );
  render(<Example />);
  expect(onCommitFiberRoot).toHaveBeenCalled();
});

it('onActive is called', () => {
  const onActive = vi.fn();
  instrument({ onActive });
  render(<Example />);
  expect(onActive).toHaveBeenCalled();
  expect(isInstrumentationActive()).toBe(true);
});

it('onCommitFiberRoot is called', () => {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  let currentFiberRoot: FiberRoot | null = null;
  const onCommitFiberRoot = vi.fn((_rendererID, fiberRoot) => {
    currentFiberRoot = fiberRoot;
  });
  instrument({ onCommitFiberRoot });
  expect(onCommitFiberRoot).not.toHaveBeenCalled();
  render(<Example />);
  expect(onCommitFiberRoot).toHaveBeenCalled();
  expect(currentFiberRoot?.current.child.type).toBe(Example);
});

it('onPostCommitFiberRoot is called', () => {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  let currentFiberRoot: FiberRoot | null = null;
  const onPostCommitFiberRoot = vi.fn((_rendererID, fiberRoot) => {
    currentFiberRoot = fiberRoot;
  });
  instrument({ onPostCommitFiberRoot });
  expect(onPostCommitFiberRoot).not.toHaveBeenCalled();
  render(<Example />);
  expect(onPostCommitFiberRoot).not.toHaveBeenCalled();
  // onPostCommitFiberRoot only called when there is a fiber root
  render(<ExampleWithEffect />);
  expect(onPostCommitFiberRoot).toHaveBeenCalled();
  expect(currentFiberRoot?.current.child.type).toBe(ExampleWithEffect);
});

it('should safeguard if version <17 or in production', () => {
  render(<Example />);
  const rdtHook = getRDTHook();
  const currentDispatcherRef = { current: null };
  rdtHook.renderers.set(1, {
    bundleType: 0,
    currentDispatcherRef,
    reconcilerVersion: '16.0.0',
    rendererPackageName: 'react-dom',
    version: '16.0.0',
  });
  const onCommitFiberRoot1 = vi.fn();
  instrument(secure({ onCommitFiberRoot: onCommitFiberRoot1 }));
  render(<Example />);
  expect(onCommitFiberRoot1).not.toHaveBeenCalled();
  instrument({
    onCommitFiberRoot: onCommitFiberRoot1,
  });
  render(<Example />);
  expect(onCommitFiberRoot1).toHaveBeenCalled();

  const onCommitFiberRoot2 = vi.fn();

  rdtHook.renderers.set(1, {
    bundleType: 1,
    currentDispatcherRef,
    reconcilerVersion: '17.0.0',
    rendererPackageName: 'react-dom',
    version: '17.0.0',
  });
  instrument(secure({ onCommitFiberRoot: onCommitFiberRoot2 }));
  render(<Example />);
  expect(onCommitFiberRoot2).toHaveBeenCalled();
});
