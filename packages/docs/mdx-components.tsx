import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { ReactNode } from 'react';

interface MDXComponents {
  [key: string]: React.ComponentType<any>;
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
  };
}
