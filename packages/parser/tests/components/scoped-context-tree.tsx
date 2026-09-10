import * as React from "react";
import type { ReactNode } from "react";

// Radix-style `createContextScope`: contexts live in an array a module-level
// `let` grows per `createContext` call, a scope hook memoizes the array under a
// computed key, and providers and consumers pick `scope[name][index]`.

type Scope = Record<string, React.Context<unknown>[]> | undefined;

const createContextScope = (scopeName: string) => {
  let defaultContexts: unknown[] = [];
  const createScopedContext = <T,>(rootComponentName: string, defaultContext?: T) => {
    const BaseContext = React.createContext<T | undefined>(defaultContext);
    const index = defaultContexts.length;
    defaultContexts = [...defaultContexts, defaultContext];
    const Provider = (props: T & { scope?: Scope; children?: ReactNode }) => {
      const { scope, children, ...context } = props;
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      const value = React.useMemo(() => context, Object.values(context));
      return <Context.Provider value={value}>{children}</Context.Provider>;
    };
    Provider.displayName = `${rootComponentName}Provider`;
    const useScopedContext = (consumerName: string, scope?: Scope): T => {
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      const context = React.useContext(Context);
      if (context) return context as T;
      if (defaultContext !== undefined) return defaultContext;
      throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
    };
    return [Provider, useScopedContext] as const;
  };
  const createScope = () => {
    const scopeContexts = defaultContexts.map((defaultContext) =>
      React.createContext(defaultContext),
    );
    return (scope?: Scope) => {
      const contexts = scope?.[scopeName] || scopeContexts;
      return React.useMemo(
        () => ({ [`__scope${scopeName}`]: { ...scope, [scopeName]: contexts } }),
        [scope, contexts],
      );
    };
  };
  createScope.scopeName = scopeName;
  return [createScopedContext, createScope] as const;
};

const MENU_NAME = "Menu";
const [createMenuContext, createMenuScope] = createContextScope(MENU_NAME);
const [MenuProvider, useMenuContext] = createMenuContext<{ open: boolean }>(MENU_NAME);
const [MenuRootProvider, useMenuRootContext] = createMenuContext<{ modal: boolean }>(MENU_NAME);
const [MenuContentProvider, useMenuContentContext] =
  createMenuContext<{ label: string }>("MenuContent");

interface ScopedProps {
  __scopeMenu?: Scope;
  children?: ReactNode;
}

const Menu = ({ __scopeMenu, children, open = false }: ScopedProps & { open?: boolean }) => (
  <MenuProvider scope={__scopeMenu} open={open}>
    <MenuRootProvider scope={__scopeMenu} modal={false}>
      {children}
    </MenuRootProvider>
  </MenuProvider>
);

const MenuContent = ({ __scopeMenu, children }: ScopedProps) => {
  const menu = useMenuContext("MenuContent", __scopeMenu);
  return menu.open ? (
    <MenuContentProvider scope={__scopeMenu} label="content">
      <div role="menu">{children}</div>
    </MenuContentProvider>
  ) : null;
};

const MenuItem = ({ __scopeMenu, children }: ScopedProps) => {
  const root = useMenuRootContext("MenuItem", __scopeMenu);
  const content = useMenuContentContext("MenuItem", __scopeMenu);
  return (
    <div role="menuitem" aria-label={content.label} data-modal={String(root.modal)}>
      {children}
    </div>
  );
};

const useMenuScope = createMenuScope();

const DropdownMenu = ({ children }: { children?: ReactNode }) => {
  const menuScope = useMenuScope(undefined);
  return (
    <Menu {...menuScope} open>
      <div style={{ display: "contents" }}>{children}</div>
    </Menu>
  );
};

const DropdownMenuContent = ({ children }: { children?: ReactNode }) => {
  const menuScope = useMenuScope(undefined);
  return <MenuContent {...menuScope}>{children}</MenuContent>;
};

const DropdownMenuItem = ({ children }: { children?: ReactNode }) => {
  const menuScope = useMenuScope(undefined);
  return <MenuItem {...menuScope}>{children}</MenuItem>;
};

export default function ScopedContextTree() {
  return (
    <DropdownMenu>
      <DropdownMenuContent>
        <DropdownMenuItem>Open</DropdownMenuItem>
        <DropdownMenuItem>Save</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
