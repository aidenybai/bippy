import { NextRequest } from 'next/server';
import TurndownService from 'turndown';

const stripScriptsAndStyles = (html: string): string => {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<link[^>]*>/gi, '');
};

export const GET = async (request: NextRequest) => {
  const origin = request.nextUrl.origin;
  const response = await fetch(`${origin}/`);
  const html = await response.text();

  const cleanedHtml = stripScriptsAndStyles(html);
  const turndownService = new TurndownService();
  const markdown = turndownService.turndown(cleanedHtml);

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
