import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-background">
        <div className="mx-auto flex h-16 max-w-screen-xl items-center justify-between px-4">
          <div className="font-bold">Bippy Documentation</div>
        </div>
      </header>
      <main className="flex-1 px-4 py-8">
        <div className="mx-auto max-w-screen-xl">
          {children}
        </div>
      </main>
    </div>
  );
}
