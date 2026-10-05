// react-hotkeys' `backwardsCompatibleContext` mutates a finished class in
// place: it stores the class's `render` as `prototype._originalRender` and
// assigns a new `prototype.render` that wraps the original result in a
// context provider, or returns null when the original rendered nothing.

import React, { Component, type ReactNode } from "react";

interface WrappedContext {
  parentId: number | undefined;
}

interface HotKeysProps {
  isHidden?: boolean;
  children?: ReactNode;
}

interface WrappingPrototype {
  render(): ReactNode;
  _originalRender?(): ReactNode;
  _childContext?: WrappedContext;
}

const provideContext = <T extends new (...args: never[]) => WrappingPrototype>(
  Wrapped: T & { contextType?: React.Context<WrappedContext> },
  defaultValue: WrappedContext,
): T => {
  if (typeof React.createContext === "undefined") {
    return Wrapped;
  }
  const context = React.createContext(defaultValue);
  Wrapped.contextType = context;
  Wrapped.prototype._originalRender = Wrapped.prototype.render;
  Wrapped.prototype.render = function render(this: WrappingPrototype) {
    const result = this._originalRender?.();
    if (result) {
      return React.createElement(
        context.Provider,
        { value: this._childContext ?? defaultValue },
        result,
      );
    }
    return null;
  };
  return Wrapped;
};

class HotKeysEnabled extends Component<HotKeysProps> {
  _childContext: WrappedContext = { parentId: 7 };

  render() {
    if (this.props.isHidden) return null;
    return <section data-hotkeys>{this.props.children}</section>;
  }
}

const HotKeys = provideContext(HotKeysEnabled, { parentId: undefined });

export default function PrototypeRenderWrap() {
  return (
    <div>
      <HotKeys>
        <p>focused</p>
      </HotKeys>
      <HotKeys isHidden>
        <p>never</p>
      </HotKeys>
    </div>
  );
}

export const isExact = true;
