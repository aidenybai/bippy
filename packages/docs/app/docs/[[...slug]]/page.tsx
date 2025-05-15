import { notFound } from 'next/navigation';
import fs from 'fs/promises';
import path from 'path';

type PageData = {
  title: string;
  description: string;
  content: string;
  slug: string[];
};

async function getPageData(slug?: string[]): Promise<PageData | null> {
  if (!slug || slug.length === 0) {
    return {
      title: 'Bippy Documentation',
      description: 'Documentation for Bippy - a toolkit to hack into React internals',
      content: 'Welcome to the Bippy documentation.',
      slug: [],
    };
  }
  return null;
}

export default async function Page(props: {
  params: { slug?: string[] };
}) {
  const page = await getPageData(props.params.slug);
  if (!page) notFound();
  
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none">
      <h1>{page.title}</h1>
      <p className="text-lg text-neutral-600 dark:text-neutral-400">{page.description}</p>
      <div>{page.content}</div>
    </div>
  );
}

export async function generateStaticParams() {
  return [{ slug: [] }];
}

export async function generateMetadata(props: {
  params: { slug?: string[] };
}) {
  const page = await getPageData(props.params.slug);
  if (!page) notFound();
  
  return {
    title: page.title,
    description: page.description,
  };
}
