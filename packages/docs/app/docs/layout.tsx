import { tree } from '@/utils/source';
import type { ReactNode } from 'react';
import '../globals.css';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-900">
        <div className="mx-auto flex h-16 max-w-screen-xl items-center justify-between px-4">
          <div className="font-bold">Bippy Documentation</div>
          <nav className="hidden md:flex space-x-6">
            {tree.main.items.map((item) => (
              <a 
                key={item.label} 
                href={item.link} 
                className="text-sm hover:text-neutral-400"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="w-64 border-r border-neutral-800 hidden md:block p-4">
          <nav>
            <ul className="space-y-2">
              {tree.main.items.map((item) => (
                <li key={item.label}>
                  {item.items ? (
                    <>
                      <div className="font-medium mb-1">{item.label}</div>
                      <ul className="pl-4 space-y-1">
                        {item.items.map((subItem) => (
                          <li key={subItem.label}>
                            <a 
                              href={subItem.link} 
                              className="text-sm hover:text-neutral-400"
                            >
                              {subItem.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <a 
                      href={item.link} 
                      className="text-sm hover:text-neutral-400"
                    >
                      {item.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main className="flex-1 p-6">
          <div className="mx-auto max-w-3xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
