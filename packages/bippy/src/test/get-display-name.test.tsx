import '../index.js'; // KEEP THIS LINE ON TOP

import { expect, it } from 'vitest';
import React, { forwardRef, memo, Component } from 'react';

import { getDisplayName } from '../index.js';

const Example = () => {
  return null;
};

Example.displayName = 'Example';

export const ForwardRefExample = forwardRef(Example);
export const MemoizedExample = memo(Example);

export class ClassComponent extends Component {
  render() {
    return <div>Hello</div>;
  }
}

it('should return the displayName of the forwardRef component', () => {
  expect(getDisplayName(ForwardRefExample)).toBe('Example');
});

it('should return the displayName of the memoized component', () => {
  expect(getDisplayName(MemoizedExample)).toBe('Example');
});

it('should return the displayName of the component', () => {
  expect(getDisplayName(Example)).toBe('Example');
});

it('should return the displayName of the class component', () => {
  expect(getDisplayName(ClassComponent)).toBe('ClassComponent');
});

it('should return null for a non-fiber', () => {
  expect(getDisplayName({})).toBe(null);
});
