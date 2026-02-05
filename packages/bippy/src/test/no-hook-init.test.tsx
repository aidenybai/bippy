import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React from 'react';
import { expect, it } from 'vitest';
import {
  isRealReactDevtools,
  isReactRefresh,
  isInstrumentationActive,
  getFiberFromHostInstance,
} from '../index.js';
import type { ReactDevToolsGlobalHook } from '../types.js';

const Example = () => {
  return <div>Hello</div>;
};

it('isRealReactDevtools should return false when passed null', () => {
  expect(isRealReactDevtools(null)).toBe(false);
});

it('isRealReactDevtools should detect devtools when hook has getFiberRoots', () => {
  const mockHookWithDevtools = {
    getFiberRoots: () => new Set(),
    renderers: new Map(),
  } as unknown as ReactDevToolsGlobalHook;

  const mockHookWithoutDevtools = {
    renderers: new Map(),
  } as unknown as ReactDevToolsGlobalHook;

  expect(isRealReactDevtools(mockHookWithDevtools)).toBe(true);
  expect(isRealReactDevtools(mockHookWithoutDevtools)).toBe(false);
});

it('isReactRefresh should return false when passed null', () => {
  expect(isReactRefresh(null)).toBe(false);
});

it('isReactRefresh should detect refresh when inject contains (injected)', () => {
  const mockHookWithRefresh = {
    inject: function inject() {
      return '(injected)';
    },
    renderers: new Map(),
  } as unknown as ReactDevToolsGlobalHook;

  const mockHookWithoutRefresh = {
    inject: function inject() {
      return 1;
    },
    renderers: new Map(),
  } as unknown as ReactDevToolsGlobalHook;

  expect(isReactRefresh(mockHookWithRefresh)).toBe(true);
  expect(isReactRefresh(mockHookWithoutRefresh)).toBe(false);
});

it('isInstrumentationActive should return true after render', () => {
  render(<Example />);
  expect(isInstrumentationActive()).toBe(true);
});

it('getFiberFromHostInstance should fallback to __reactFiber property', () => {
  const mockFiber = { type: 'div', tag: 5 };
  const element = document.createElement('div') as unknown as Record<
    string,
    unknown
  >;
  element['__reactFiber$abc123'] = mockFiber;

  const result = getFiberFromHostInstance(element);
  expect(result).toBe(mockFiber);
});

it('getFiberFromHostInstance should fallback to __reactInternalInstance property', () => {
  const mockFiber = { type: 'span', tag: 5 };
  const element = document.createElement('span') as unknown as Record<
    string,
    unknown
  >;
  element['__reactInternalInstance$xyz789'] = mockFiber;

  const result = getFiberFromHostInstance(element);
  expect(result).toBe(mockFiber);
});
