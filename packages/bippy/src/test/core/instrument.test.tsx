/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';
import type { FiberRoot } from '../../types.js';
import {
  getRDTHook,
  instrument,
  isInstrumentationActive,
  onCommitFiberRoot,
  secure,
} from '../../index.js';
import React from 'react';
import { render } from '@testing-library/react';
import { BasicComponent, BasicComponentWithEffect } from '../components.js';

describe('instrument', () => {
  it('should not fail if __REACT_DEVTOOLS_GLOBAL_HOOK__ exists already', () => {
    render(<BasicComponent />);
    const onCommitFiberRoot = vi.fn();
    instrument(
      secure({ onCommitFiberRoot }, { dangerouslyRunInProduction: true })
    );
    render(<BasicComponent />);
    expect(onCommitFiberRoot).toHaveBeenCalled();
  });

  it('onActive is called', async () => {
    const onActive = vi.fn();
    instrument({ onActive });
    render(<BasicComponent />);
    expect(onActive).toHaveBeenCalled();
    expect(isInstrumentationActive()).toBe(true);
  });

  it('onCommitFiberRoot is called', () => {
    let currentFiberRoot: FiberRoot | null = null;
    const onCommitFiberRoot = vi.fn((_rendererID, fiberRoot) => {
      currentFiberRoot = fiberRoot;
    });
    instrument({ onCommitFiberRoot });
    expect(onCommitFiberRoot).not.toHaveBeenCalled();
    render(<BasicComponent />);
    expect(onCommitFiberRoot).toHaveBeenCalled();
    expect(currentFiberRoot?.current.child.type).toBe(BasicComponent);
  });

  it('onPostCommitFiberRoot is called', async () => {
    let currentFiberRoot: FiberRoot | null = null;
    const onPostCommitFiberRoot = vi.fn((_rendererID, fiberRoot) => {
      currentFiberRoot = fiberRoot;
    });
    instrument({ onPostCommitFiberRoot });
    expect(onPostCommitFiberRoot).not.toHaveBeenCalled();
    render(<BasicComponent />);
    expect(onPostCommitFiberRoot).not.toHaveBeenCalled();
    // onPostCommitFiberRoot only called when there is a fiber root
    render(<BasicComponentWithEffect />);
    expect(onPostCommitFiberRoot).toHaveBeenCalled();
    expect(currentFiberRoot?.current.child.type).toBe(BasicComponentWithEffect);
  });

  it('should safeguard if version <17 or in production', () => {
    render(<BasicComponent />);
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
    render(<BasicComponent />);
    expect(onCommitFiberRoot1).not.toHaveBeenCalled();
    instrument({
      onCommitFiberRoot: onCommitFiberRoot1,
    });
    render(<BasicComponent />);
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
    render(<BasicComponent />);
    expect(onCommitFiberRoot2).toHaveBeenCalled();
  });
});

describe('onCommitFiberRoot', () => {
  it('should call the handler with the fiber root', () => {
    const handler = vi.fn();
    onCommitFiberRoot(handler);
    render(<BasicComponent />);
    expect(handler).toHaveBeenCalled();
  });
});
