import { type NextRequest, NextResponse } from "next/server";

const MARKDOWN_PATHS = new Set(["/llm.txt", "/llms.txt"]);

const getAcceptsMarkdown = (request: NextRequest) =>
  request.headers.get("accept")?.includes("text/markdown") ?? false;

export const middleware = (request: NextRequest) => {
  const response =
    getAcceptsMarkdown(request) && !MARKDOWN_PATHS.has(request.nextUrl.pathname)
      ? NextResponse.rewrite(new URL("/llms.txt", request.url))
      : NextResponse.next();

  response.headers.set("Vary", "Accept");
  return response;
};

export const config = {
  matcher: "/((?!_next/).*)",
};
