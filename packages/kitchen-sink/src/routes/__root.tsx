import React from 'react';
import {
  createRootRoute,
  Link,
  Outlet,
  useRouter,
} from '@tanstack/react-router';
import Inspector from 'bippy/dist/experiments/inspect';

interface RouteInfo {
  path: string;
  label: string;
}

interface RouteChild {
  path?: string;
}

export const Route = createRootRoute({
  component: () => {
    const router = useRouter();
    const routes = Object.entries(router.routeTree.children ?? {})
      .map(([_, route]) => {
        const routeChild = route as RouteChild;
        const path = routeChild.path;
        if (!path) return null;
        return {
          path,
          label: path,
        };
      })
      .filter((route): route is RouteInfo => route !== null)
      .sort((a, b) =>
        a.path === '/' ? -1 : b.path === '/' ? 1 : a.path.localeCompare(b.path),
      );

    return (
      <>
        <div className="min-h-screen flex flex-col bg-neutral-900 text-white">
          <Inspector enabled={true} dangerouslyRunInProduction={true} />
          <div className="flex-1">
            <Outlet />
          </div>
          {process.env.NODE_ENV === 'development' && (
            <div className="border-t border-gray-700 fixed w-full bg-neutral-800 z-50 bottom-0">
              <div className="p-2 flex flex-wrap gap-2">
                {routes.map((route, i) => (
                  <React.Fragment key={route.path}>
                    <Link
                      to={route.path}
                      className="[&.active]:font-bold underline hover:bg-white hover:text-black"
                    >
                      {route.label}
                    </Link>
                    {i < routes.length - 1 && (
                      <div className="w-px bg-neutral-600 h-4 my-auto" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    );
  },
});
