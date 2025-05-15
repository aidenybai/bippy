import { createTree } from 'fumadocs-core/server';

export const tree = createTree({
  main: {
    label: 'Documentation',
    items: [
      {
        label: 'Introduction',
        link: '/docs',
      },
      {
        label: 'How It Works',
        link: '/docs/how-it-works',
      },
      {
        label: 'API Reference',
        items: [
          {
            label: 'Core API',
            link: '/docs/api/core',
          },
          {
            label: 'Utility Functions',
            link: '/docs/api/utils',
          },
        ],
      },
      {
        label: 'Examples',
        link: '/docs/examples',
      },
    ],
  },
});
