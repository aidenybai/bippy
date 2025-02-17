import { type NextRequest, NextResponse } from 'next/server';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { Page, Browser } from 'puppeteer-core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const CHROMIUM_PATH = 'https://fs.bippy.dev/chromium.tar';
const BIPPY_SOURCE = process.env.BIPPY_SOURCE as string;
const INJECT_SOURCE = process.env.INJECT_SOURCE as string;

const CHROMIUM_ARGS = [
  '--enable-webgl',
  '--enable-accelerated-2d-canvas',
  '--disable-blink-features=AutomationControlled',
  '--disable-web-security',
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getBrowser = async (): Promise<Browser> => {
  if (process.env.NODE_ENV === 'production') {
    const chromium = await import('@sparticuz/chromium-min').then(
      (mod) => mod.default,
    );
    const puppeteerCore = await import('puppeteer-core').then(
      (mod) => mod.default,
    );
    const executablePath = await chromium.executablePath(CHROMIUM_PATH);
    const browser = await puppeteerCore.launch({
      args: [...chromium.args, ...CHROMIUM_ARGS],
      defaultViewport: null,
      executablePath,
      headless: chromium.headless,
    });
    return browser;
  }

  const puppeteer = await import('puppeteer').then((mod) => mod.default);
  // Cast the development browser to match production type
  return (await puppeteer.launch({
    defaultViewport: null,
    args: CHROMIUM_ARGS,
    headless: false,
  })) as unknown as Browser;
};

export const POST = async (request: NextRequest) => {
  if (!BIPPY_SOURCE || !INJECT_SOURCE) {
    return NextResponse.json(
      { error: 'Failed to inject sources' },
      { status: 500 },
    );
  }

  const browser = await getBrowser();
  const { url } = await request.json();
  const page = (await browser.newPage()) as Page;

  const stylesheets = new Map<string, string>();

  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    if (request.resourceType() === 'stylesheet') {
      try {
        const response = await fetch(request.url());
        const cssContent = await response.text();
        stylesheets.set(request.url(), cssContent);
      } catch (error) {
        console.error(`Failed to fetch stylesheet: ${request.url()}`, error);
      }
    }
    request.continue();
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [0, 1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'headless', { get: () => undefined });
  });

  await page.evaluateOnNewDocument(`${BIPPY_SOURCE}\n\n${INJECT_SOURCE}`);

  await page.goto(url, { waitUntil: ['domcontentloaded', 'load'] });

  const title = await page.title();
  const description = await page.evaluate(() => {
    return document
      .querySelector('meta[name="description"]')
      ?.getAttribute('content');
  });

  const html = await page.content();

  const rawScreenshot = await page.screenshot({
    optimizeForSpeed: true,
    quality: 80,
    type: 'jpeg',
  });

  await page.evaluate(() => {
    const colors = getImageColors(rawScreenshot, 'image/jpeg');
    console.log(colors);
  });

  await delay(1000);

  const screenshot = await page.screenshot({
    optimizeForSpeed: true,
    quality: 80,
    type: 'jpeg',
  });

  const stringifiedElementMap = await page.evaluate(() => {
    // https://x.com/theo/status/1889972653785764084
    const estimateTokenCount = (text?: string | undefined) => {
      if (!text) return 0;
      return text.length / 4;
    };

    let allocatedTokens = 800_000;
    let stringifiedElementMap = '';

    // biome-ignore lint/suspicious/noExplicitAny: OK
    const elementMap = (globalThis as any).ShrinkwrapData.elementMap;

    for (const [id, elements] of elementMap.entries()) {
      let stringPart = `# id: ${id}\n`;
      for (const element of Array.from(elements)) {
        const html = (element as Element).outerHTML;
        const tokens = estimateTokenCount(html);
        if (tokens > allocatedTokens) {
          break;
        }
        allocatedTokens -= tokens;
        stringPart += `## html: ${html}\n`;
      }
      stringifiedElementMap += `${stringPart}\n\n`;
    }

    return stringifiedElementMap.trim();
  });

  const { object } = await generateObject({
    model: google('gemini-2.0-flash', { structuredOutputs: true }),
    // @ts-expect-error ai sdk is being stupid
    schema: z.object({
      page_summary: z
        .string()
        .describe('A summary of the page and what it is for'),
      components: z.array(
        z.object({
          id: z
            .number()
            .describe('The number id displayed in the provided image'),
          role: z
            .string()
            .describe(
              'The role of the component. Be descriptive such that a human can understand the purpose of the component and recreate it.',
            ),
          isImportant: z
            .boolean()
            .describe(
              'Whether the component is important to the overall design of the page',
            ),
          reactComponentFunctionDefinition: z
            .string()
            .describe(
              'The code that would recreate the component. This should be a valid React component function snippet that can be rendered in a React application.',
            ),
        }),
      ),
    }),
    messages: [
      {
        role: 'user',
        content: `Page: ${url}
Title: ${title}
Description: ${description}

Analyze this web application screenshot and provide:

1. A concise summary of the page's purpose and main functionality

2. For each numbered component visible in the screenshot, describe:
   - A suggested component name (e.g. "SearchBar", "NavigationMenu")
   - Its role and purpose in the interface
   - Visual characteristics and positioning
   - Interaction patterns and behaviors
   - Whether it's a critical/important component

Key points to consider:
- Focus on components with clear boundaries and purposes
- Note any recurring patterns or reusable elements
- Identify interactive elements and complex UI patterns
- Skip basic containers or simple text elements
- Be careful, do not assume a components role, look through the page exhaustively
- The reactComponentFunctionDefinition should be a valid React component function. Don't just return the html, return a valid React component function snippet.

Provide detailed information about ALL numbered components visible in the screenshot, even if they seem minor. Each component should have a clear role description that would allow recreation.`,
      },
      {
        role: 'user',
        content: `Element Map: ${stringifiedElementMap}`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image',
            image: screenshot,
          },
        ],
      },
    ],
  });

  return NextResponse.json({ result: object });
};
