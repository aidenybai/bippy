import { describe, expect, it } from 'vitest';

import { getDisplayName, getType } from '../../index.js';
import {
  BasicComponent,
  ClassComponent,
  ForwardRefComponent,
  MemoizedComponent,
} from '../components.js';

describe('getType', () => {
  it('should return the type of the forwardRef component', () => {
    expect(getType(ForwardRefComponent)).toBe(BasicComponent);
  });

  it('should return the type of the memoized component', () => {
    expect(getType(MemoizedComponent)).toBe(BasicComponent);
  });

  it('should return same type for a normal component', () => {
    expect(getType(BasicComponent)).toBe(BasicComponent);
  });

  it('should return the type of the class component', () => {
    expect(getType(ClassComponent)).toBe(ClassComponent);
  });

  it('should return null for a non-fiber', () => {
    expect(getType({})).toBe(null);
  });
});

describe('getDisplayName', () => {
  it('should return the displayName of the forwardRef component', () => {
    expect(getDisplayName(ForwardRefComponent)).toBe('BasicComponent');
  });

  it('should return the displayName of the memoized component', () => {
    expect(getDisplayName(MemoizedComponent)).toBe('BasicComponent');
  });

  it('should return the displayName of the component', () => {
    expect(getDisplayName(BasicComponent)).toBe('BasicComponent');
  });

  it('should return the displayName of the class component', () => {
    expect(getDisplayName(ClassComponent)).toBe('ClassComponent');
  });

  it('should return null for a non-fiber', () => {
    expect(getDisplayName({})).toBe(null);
  });
});
