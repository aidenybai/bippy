import { NextRequest, NextResponse } from 'next/server';

export const middleware = (request: NextRequest): NextResponse => {
  const acceptHeader = request.headers.get('accept') ?? '';

  const isMarkdownRequest =
    request.nextUrl.pathname === '/' && acceptHeader.includes('text/markdown');

  if (isMarkdownRequest) {
    return NextResponse.rewrite(new URL('/llms.txt', request.url));
  }

  return NextResponse.next();
};

export const config = {
  matcher: '/',
};
