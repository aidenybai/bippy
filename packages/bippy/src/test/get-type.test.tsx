import '../index.js'; // KEEP THIS LINE ON TOP

import { expect, it } from 'vitest';

import { getType } from '../index.js';
import React, { Component, forwardRef, memo } from 'react';

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

it('should return the type of the forwardRef component', () => {
  expect(getType(ForwardRefExample)).toBe(Example);
});

it('should return the type of the memoized component', () => {
  expect(getType(MemoizedExample)).toBe(Example);
});

it('should return same type for a normal component', () => {
  expect(getType(Example)).toBe(Example);
});

it('should return the type of the class component', () => {
  expect(getType(ClassComponent)).toBe(ClassComponent);
});

it('should return null for a non-fiber', () => {
  expect(getType({})).toBe(null);
});
