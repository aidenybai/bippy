import { readFile } from 'fs/promises';
import { join } from 'path';

export const GET = async (): Promise<Response> => {
  const readmePath = join(process.cwd(), '..', 'bippy', 'README.md');
  const readme = await readFile(readmePath, 'utf-8');

  return new Response(readme, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });
};
