import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  Fiber,
  getNearestHostFiber,
  getNearestHostFibers,
  instrument,
} from '../index.js';

export const Example = () => {
  return <div>Hello</div>;
};

export const ExampleWithChildrenProp = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return <div>{children}</div>;
};

export const ExampleWithMultipleChildElements = () => {
  return (
    <>
      <div>Hello</div>
      <div>Hello</div>
    </>
  );
};

export const ExampleWithUnmount = () => {
  const [shouldUnmount, setShouldUnmount] = React.useState(true);
  React.useEffect(() => {
    setShouldUnmount(false);
  }, []);
  return shouldUnmount ? <div>Hello</div> : null;
};

describe('getNearestHostFiber', () => {
  it('should return the nearest host fiber', () => {
    let maybeFiber: Fiber | null = null;
    let maybeHostFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
        maybeHostFiber = fiberRoot.current.child.child;
      },
    });
    render(<Example />);
    expect(getNearestHostFiber(maybeFiber as unknown as Fiber)).toBe(
      (maybeFiber as unknown as Fiber).child,
    );
    expect(maybeHostFiber).toBe(
      getNearestHostFiber(maybeFiber as unknown as Fiber),
    );
  });

  it('should return null for unmounted fiber', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ExampleWithUnmount />);
    expect(getNearestHostFiber(maybeFiber as unknown as Fiber)).toBe(null);
  });
});

describe('getNearestHostFibers', () => {
  it('should return all host fibers', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ExampleWithMultipleChildElements />);
    expect(getNearestHostFibers(maybeFiber as unknown as Fiber)).toHaveLength(
      2,
    );
  });
});
