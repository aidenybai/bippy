import { notFound } from 'next/navigation';
import fs from 'fs/promises';
import path from 'path';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { compileMDX } from 'next-mdx-remote/rsc';
import type { Metadata } from 'next';

type Params = {
  slug?: string[];
};

type Frontmatter = {
  title: string;
  description?: string;
};

async function getMdxContent(slug?: string[]) {
  try {
    const contentDir = path.join(process.cwd(), 'content/docs');
    let filePath;
    
    if (!slug || slug.length === 0) {
      filePath = path.join(contentDir, 'index.mdx');
    } else if (slug.length === 1) {
      filePath = path.join(contentDir, `${slug[0]}.mdx`);
    } else {
      filePath = path.join(contentDir, ...slug) + '.mdx';
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    
    const { frontmatter, content: mdxContent } = await compileMDX<Frontmatter>({
      source: content,
      options: { parseFrontmatter: true }
    });
    
    return {
      content: mdxContent,
      frontmatter: frontmatter as Frontmatter
    };
  } catch (error) {
    console.error('Error loading MDX file:', error);
    return null;
  }
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const resolvedParams = await params;
  const mdxData = await getMdxContent(resolvedParams.slug);
  
  if (!mdxData) {
    notFound();
  }
  
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none">
      <h1>{mdxData.frontmatter.title}</h1>
      {mdxData.frontmatter.description && (
        <p className="text-lg text-neutral-600 dark:text-neutral-400">
          {mdxData.frontmatter.description}
        </p>
      )}
      <div>{mdxData.content}</div>
    </div>
  );
}

export async function generateStaticParams() {
  try {
    const contentDir = path.join(process.cwd(), 'content/docs');
    const files = await fs.readdir(contentDir, { recursive: true });
    
    const paths = files
      .filter(file => file.endsWith('.mdx'))
      .map(file => {
        if (file === 'index.mdx') {
          return { slug: [] };
        } else if (file.includes('/')) {
          return { 
            slug: file.replace(/\.mdx$/, '').split('/').filter(Boolean)
          };
        } else {
          return { 
            slug: [file.replace(/\.mdx$/, '')]
          };
        }
      });
    
    return paths;
  } catch (error) {
    console.error('Error generating static params:', error);
    return [{ slug: [] }];
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const resolvedParams = await params;
  const mdxData = await getMdxContent(resolvedParams.slug);
  
  if (!mdxData) {
    notFound();
  }
  
  return {
    title: mdxData.frontmatter.title,
    description: mdxData.frontmatter.description,
  };
}
