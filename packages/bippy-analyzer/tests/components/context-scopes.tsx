import * as React from "react";
import type { ReactNode } from "react";

// Radix `createContextScope`: each `createContext` call appends to a
// module-level `let` list that `createScope` reads later, and a scope passes
// freshly created (unnamed) contexts to providers through a computed
// `__scope${name}` key so a runtime Provider may render a context other than
// the one created next to it.

interface ScopeContexts {
  [scopeName: string]: React.Context<unknown>[] | undefined;
}

interface ScopeProps {
  [scopeKey: string]: ScopeContexts | undefined;
}

interface ProviderProps {
  scope?: ScopeContexts;
  children?: ReactNode;
  [contextKey: string]: unknown;
}

interface ScopeHook {
  (scope: ScopeContexts | undefined): ScopeProps;
}

interface ProviderComponent {
  (props: ProviderProps): ReactNode;
  displayName?: string;
}

interface UseScopedContext {
  (scope: ScopeContexts | undefined): unknown;
}

interface CreateContext {
  (rootComponentName: string, defaultContext: unknown): [ProviderComponent, UseScopedContext];
}

interface CreateScope {
  (): ScopeHook;
  scopeName: string;
}

const createContextScope = (
  scopeName: string,
  dependencies: CreateScope[] = [],
): [CreateContext, CreateScope] => {
  let defaultContexts: unknown[] = [];

  const createContext: CreateContext = (rootComponentName, defaultContext) => {
    const BaseContext = React.createContext(defaultContext);
    BaseContext.displayName = `${rootComponentName}Context`;
    const index = defaultContexts.length;
    defaultContexts = [...defaultContexts, defaultContext];

    const Provider: ProviderComponent = (props) => {
      const { scope, children, ...context } = props;
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      const value = React.useMemo(() => context, Object.values(context));
      return <Context.Provider value={value}>{children}</Context.Provider>;
    };
    Provider.displayName = `${rootComponentName}Provider`;

    const useScopedContext: UseScopedContext = (scope) => {
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      return React.useContext(Context);
    };
    return [Provider, useScopedContext];
  };

  const createScope: CreateScope = () => {
    const scopeContexts = defaultContexts.map((defaultContext) =>
      React.createContext(defaultContext),
    );
    return (scope: ScopeContexts | undefined): ScopeProps => {
      const contexts = scope?.[scopeName] || scopeContexts;
      return React.useMemo(
        () => ({ [`__scope${scopeName}`]: { ...scope, [scopeName]: contexts } }),
        [scope, contexts],
      );
    };
  };
  createScope.scopeName = scopeName;
  return [createContext, composeContextScopes(createScope, ...dependencies)];
};

const composeContextScopes = (...scopes: CreateScope[]): CreateScope => {
  const baseScope = scopes[0];
  if (scopes.length === 1) return baseScope;
  const createScope: CreateScope = () => {
    const scopeHooks = scopes.map((createInnerScope) => ({
      useScope: createInnerScope(),
      scopeName: createInnerScope.scopeName,
    }));
    return (overrideScopes: ScopeContexts | undefined): ScopeProps => {
      const nextScopes = scopeHooks.reduce<ScopeContexts>(
        (mergedScopes, { useScope, scopeName }) => {
          const scopeProps = useScope(overrideScopes);
          const currentScope = scopeProps[`__scope${scopeName}`];
          return { ...mergedScopes, ...currentScope };
        },
        {},
      );
      return React.useMemo(() => ({ [`__scope${baseScope.scopeName}`]: nextScopes }), [nextScopes]);
    };
  };
  createScope.scopeName = baseScope.scopeName;
  return createScope;
};

const [createPopperContext, createPopperScope] = createContextScope("Popper");
const [PopperProvider, usePopperContext] = createPopperContext("Popper", undefined);

const [createMenuContext, createMenuScope] = createContextScope("Menu", [createPopperScope]);
const [MenuProvider, useMenuContext] = createMenuContext("Menu", undefined);
const [MenuRootProvider] = createMenuContext("MenuRoot", undefined);

const usePopperScope = createPopperScope();
const useMenuScope = createMenuScope();

interface MenuProps {
  __scopeMenu?: ScopeContexts;
  children?: ReactNode;
}

const Popper = ({
  __scopePopper,
  children,
}: {
  __scopePopper?: ScopeContexts;
  children?: ReactNode;
}) => (
  <PopperProvider scope={__scopePopper} anchor={null}>
    {children}
  </PopperProvider>
);

const Menu = ({ __scopeMenu, children }: MenuProps) => {
  const popperScope = usePopperScope(__scopeMenu);
  return (
    <Popper {...popperScope}>
      <MenuProvider scope={__scopeMenu} open={false}>
        <MenuRootProvider scope={__scopeMenu} modal>
          {children}
        </MenuRootProvider>
      </MenuProvider>
    </Popper>
  );
};

const MenuItem = ({ __scopeMenu }: { __scopeMenu?: ScopeContexts }) => {
  const menu = useMenuContext(__scopeMenu);
  const popper = usePopperContext(__scopeMenu);
  return (
    <li>
      {menu ? <b /> : <i />}
      {popper ? <b /> : <i />}
    </li>
  );
};

const UnscopedItem = () => (useMenuContext(undefined) ? <b /> : <i />);

const DropdownMenu = ({ children }: { children?: ReactNode }) => {
  const menuScope = useMenuScope(undefined);
  return <Menu {...menuScope}>{children}</Menu>;
};

const DropdownMenuItem = () => {
  const menuScope = useMenuScope(undefined);
  return <MenuItem {...menuScope} />;
};

export default () => (
  <ul>
    <DropdownMenu>
      <DropdownMenuItem />
      <UnscopedItem />
    </DropdownMenu>
    <Menu>
      <MenuItem />
    </Menu>
  </ul>
);
