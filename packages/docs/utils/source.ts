import fs from 'fs/promises';
import path from 'path';

export async function getPages() {
  try {
    const contentDir = path.join(process.cwd(), 'content/docs');
    const files = await fs.readdir(contentDir, { recursive: true });
    
    return files
      .filter(file => file.endsWith('.mdx'))
      .map(file => {
        const fullPath = path.join(contentDir, file);
        const slug = file === 'index.mdx' 
          ? '/' 
          : '/' + file.replace(/\.mdx$/, '');
        
        return {
          slug,
          path: fullPath,
        };
      });
  } catch (error) {
    console.error('Error loading MDX files:', error);
    return [];
  }
}

export const source = { getPages };

export const tree = {
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
      {
        label: 'Glossary',
        link: '/docs/glossary',
      },
      {
        label: 'Development',
        link: '/docs/development',
      },
    ],
  },
};
