import * as React from "react";
import type { ReactNode } from "react";

type Scope = Record<string, Record<string, React.Context<unknown>[]> | undefined> | undefined;

interface CreateScope {
  (): (scope: Scope) => Record<string, Record<string, React.Context<unknown>[]>>;
  scopeName: string;
}

const composeContextScopes = (...scopes: CreateScope[]): CreateScope => {
  const baseScope = scopes[0];
  if (scopes.length === 1) return baseScope;
  const createScope: CreateScope = () => {
    const scopeHooks = scopes.map((innerCreateScope) => ({
      useScope: innerCreateScope(),
      scopeName: innerCreateScope.scopeName,
    }));
    return function useComposedScopes(overrideScopes: Scope) {
      const nextScopes = scopeHooks.reduce<Record<string, React.Context<unknown>[]>>(
        (composed, { useScope, scopeName }) => {
          const scopeProps = useScope(overrideScopes);
          const currentScope = scopeProps[`__scope${scopeName}`];
          return { ...composed, ...currentScope };
        },
        {},
      );
      return React.useMemo(() => ({ [`__scope${baseScope.scopeName}`]: nextScopes }), [nextScopes]);
    };
  };
  createScope.scopeName = baseScope.scopeName;
  return createScope;
};

const createContextScope = (scopeName: string, deps: CreateScope[] = []) => {
  let defaultContexts: unknown[] = [];
  const createScopedContext = <Value,>(rootComponentName: string, defaultContext?: Value) => {
    const BaseContext = React.createContext<Value | undefined>(defaultContext);
    BaseContext.displayName = rootComponentName + "Context";
    const index = defaultContexts.length;
    defaultContexts = [...defaultContexts, defaultContext];
    const Provider = (props: Value & { scope: Scope; children?: ReactNode }) => {
      const { scope, children, ...context } = props;
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      const value = React.useMemo(() => context, Object.values(context));
      return <Context.Provider value={value}>{children}</Context.Provider>;
    };
    Provider.displayName = rootComponentName + "Provider";
    const useScopedContext = (consumerName: string, scope: Scope) => {
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      const context = React.useContext(Context);
      if (context) return { ...context, contextName: Context.displayName ?? "scoped" };
      throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
    };
    return [Provider, useScopedContext] as const;
  };
  const createScope: CreateScope = () => {
    const scopeContexts = defaultContexts.map((defaultContext) =>
      React.createContext(defaultContext),
    );
    return function useScope(scope: Scope) {
      const contexts = scope?.[scopeName] || scopeContexts;
      return React.useMemo(
        () => ({ [`__scope${scopeName}`]: { ...scope, [scopeName]: contexts } }),
        [scope, contexts],
      );
    };
  };
  createScope.scopeName = scopeName;
  return [createScopedContext, composeContextScopes(createScope, ...deps)] as const;
};

const [createPopperContext, createPopperScope] = createContextScope("Popper");
const [PopperProvider, usePopperContext] = createPopperContext<{ anchor: string }>("Popper");

const Popper = ({ __scopePopper, children }: { __scopePopper?: Scope; children: ReactNode }) => (
  <PopperProvider scope={__scopePopper} anchor="top">
    {children}
  </PopperProvider>
);

const PopperAnchor = ({ __scopePopper }: { __scopePopper?: Scope }) => {
  const { anchor, contextName } = usePopperContext("PopperAnchor", __scopePopper);
  return (
    <b>
      {anchor}
      <i>{contextName}</i>
    </b>
  );
};

const [createMenuContext, createMenuScope] = createContextScope("Menu", [createPopperScope]);
const [MenuProvider, useMenuContext] = createMenuContext<{ open: boolean }>("Menu");
const usePopperScope = createPopperScope();

const Menu = ({ __scopeMenu, children }: { __scopeMenu?: Scope; children: ReactNode }) => {
  const popperScope = usePopperScope(__scopeMenu);
  return (
    <Popper {...popperScope}>
      <MenuProvider scope={__scopeMenu} open>
        {children}
      </MenuProvider>
    </Popper>
  );
};

const MenuAnchor = ({ __scopeMenu }: { __scopeMenu?: Scope }) => {
  const popperScope = usePopperScope(__scopeMenu);
  const { open, contextName } = useMenuContext("MenuAnchor", __scopeMenu);
  return (
    <span>
      {open ? contextName : "closed"}
      <PopperAnchor {...popperScope} />
    </span>
  );
};

const [createDropdownContext] = createContextScope("Dropdown", [createMenuScope]);
const [DropdownProvider, useDropdownContext] = createDropdownContext<{ label: string }>("Dropdown");
const useMenuScope = createMenuScope();

const Dropdown = ({ children }: { children: ReactNode }) => {
  const menuScope = useMenuScope(undefined);
  return (
    <DropdownProvider scope={undefined} label="menu">
      <Menu {...menuScope}>{children}</Menu>
    </DropdownProvider>
  );
};

const DropdownTrigger = () => {
  const menuScope = useMenuScope(undefined);
  const { label, contextName } = useDropdownContext("DropdownTrigger", undefined);
  return (
    <button>
      {label}
      {contextName}
      <MenuAnchor {...menuScope} />
    </button>
  );
};

export default function ScopedContext() {
  return (
    <Dropdown>
      <DropdownTrigger />
    </Dropdown>
  );
}
