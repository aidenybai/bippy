import { type NextRequest, NextResponse } from 'next/server';
import { google } from '@ai-sdk/google';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { Browser } from 'puppeteer-core';
import { TailwindConverter } from 'css-to-tailwindcss';
import postcss from 'postcss';
import { extractColors } from 'extract-colors';
import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

let cachedInjectSource: string | undefined;
let cachedBippySource: string | undefined;

const loadSources = async () => {
  if (process.env.NODE_ENV === 'development') {
    const [injectSource, bippySource] = await Promise.all([
      fs.readFile(
        path.join(process.cwd(), 'inject/dist/index.global.js'),
        'utf-8'
      ),
      fs.readFile(
        path.join(process.cwd(), 'node_modules/bippy/dist/index.global.js'),
        'utf-8'
      )
    ]);
    return { injectSource, bippySource };
  }

  if (cachedInjectSource && cachedBippySource) {
    return { injectSource: cachedInjectSource, bippySource: cachedBippySource };
  }

  const [injectSource, bippySource] = await Promise.all([
    fs.readFile(
      path.join(process.cwd(), 'inject/dist/index.global.js'),
      'utf-8'
    ),
    fs.readFile(
      path.join(process.cwd(), 'node_modules/bippy/dist/index.global.js'),
      'utf-8'
    )
  ]);

  cachedInjectSource = injectSource;
  cachedBippySource = bippySource;

  return { injectSource, bippySource };
};

const shouldCloseBrowser = true;

const CHROMIUM_PATH = 'https://fs.bippy.dev/chromium.tar';

const CHROMIUM_ARGS = [
  '--enable-webgl',
  '--enable-accelerated-2d-canvas',
  '--disable-blink-features=AutomationControlled',
  '--disable-web-security',
];

const postCSSStripKeyframes = postcss([
  {
    postcssPlugin: 'strip-keyframes',
    Once(root) {
      root.walkAtRules('keyframes', (rule) => {
        rule.remove();
      });
    },
  },
]);

const stripCSSKeyframes = (rawCSS: string) => {
  const { css: strippedCSS } = postCSSStripKeyframes.process(rawCSS);
  return strippedCSS;
};

const converter = new TailwindConverter({
  tailwindConfig: {
    content: [],
    theme: {
      extend: {},
    },
  },
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const convertBufferToDataUrl = (buffer: Buffer, mimeType: string) => {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
};

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
  return (await puppeteer.launch({
    defaultViewport: null,
    args: CHROMIUM_ARGS,
    headless: false,
  })) as unknown as Browser;
};

export const POST = async (request: NextRequest) => {
  const { injectSource, bippySource } = await loadSources();

  if (!bippySource || !injectSource) {
    return NextResponse.json(
      { error: 'Failed to load sources' },
      { status: 500 },
    );
  }

  const { url, prompt } = await request.json();

  // Validate URL
  if (!url) {
    return NextResponse.json(
      { error: 'URL is required' },
      { status: 400 },
    );
  }

  let browser: Browser | undefined;
  try {
    browser = await getBrowser();

    const abortController = new AbortController();
    request.signal.addEventListener('abort', () => {
      abortController.abort();
      if (browser) {
        browser.close().catch(console.error);
      }
    });

    // Get the default page instead of creating a new one
    const [page] = await browser.pages();

    const stylesheets = new Map<string, string>();

    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      if (request.resourceType() === 'stylesheet') {
        const response = await fetch(request.url());
        const cssContent = await response.text();
        stylesheets.set(request.url(), cssContent);
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

    const scripts = [bippySource, injectSource];
    await page.evaluateOnNewDocument(scripts.join('\n\n'));

    await page.goto(url, { waitUntil: ['domcontentloaded', 'load'] });

    const cssPromise = Promise.all(
      Array.from(stylesheets.values()).map(async (rawCSS) => {
        try {
          const strippedCSS = stripCSSKeyframes(rawCSS);
          const { nodes } = await converter.convertCSS(strippedCSS);
          return nodes.map(node => ({ selector: node.rule.selector, classes: node.tailwindClasses }));
        } catch {
          return [];
        }
      })
    );

    await delay(1000);

    const [
      title,
      description,
      html,
      rawScreenshot,
      cssResults
    ] = await Promise.all([
      page.title(),
      page.evaluate(() =>
        document.querySelector('meta[name="description"]')?.getAttribute('content')
      ),
      page.evaluate(() => {
        const bodyClone = document.body.cloneNode(true) as HTMLElement;
        const removeElements = bodyClone.querySelectorAll(
          'script, link, style, noscript, iframe, [aria-hidden="true"], .hidden, [hidden]'
        );
        for (const el of removeElements) el.remove();

        const removeEmpty = (element: HTMLElement) => {
          for (const child of element.children) {
            if (child instanceof HTMLElement) removeEmpty(child);
          }
          if (!element.innerHTML.trim() && element.parentElement) {
            element.remove();
          }
        };
        removeEmpty(bodyClone);
        return bodyClone.innerHTML.trim();
      }),
      page.screenshot(
        {
          optimizeForSpeed: true,
          quality: 80,
          type: 'jpeg' as const,
          encoding: 'binary' as const,
          omitBackground: true,
        }
      ),
      cssPromise
    ]);

    const cssSelectors: Record<string, string[]> = {};
    for (const result of cssResults.flat()) {
      if (result.selector && result.classes) {
        cssSelectors[result.selector] = result.classes;
      }
    }

    const [imageData, screenshotDataUrl, bodyChunks] = await Promise.all([
      (async () => {
        const image = await loadImage(rawScreenshot);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      })(),
      convertBufferToDataUrl(rawScreenshot, 'image/jpeg'),
      (async () => {
        const chunks: string[] = [];
        const chunkSize = 900000 * 4;
        for (let i = 0; i < html.length; i += chunkSize) {
          chunks.push(html.slice(i, i + chunkSize));
        }
        return chunks;
      })()
    ]);

    type GeminiResponse = { text: string };

    const [palette, summaryChunks] = await Promise.all([
      extractColors(imageData),
      (async () => {
        const results: GeminiResponse[] = [];
        const concurrencyLimit = Math.min(3, bodyChunks.length);
        for (let i = 0; i < bodyChunks.length; i += concurrencyLimit) {
          const batch = bodyChunks.slice(i, i + concurrencyLimit);
          const batchPromises = batch.map(async (chunk) => {
            try {
              const response = await generateText({
                model: google('gemini-2.0-flash'),
                messages: [
                  {
                    role: 'user',
                    content: `Page: ${url}\nTitle: ${title}\nDescription: ${description}\n\n\`\`\`html\n${chunk}\n\`\`\`\n\nProvide a concise list of steps to re-create this page. Only return the steps, no other text.`,
                  },
                  {
                    role: 'user',
                    content: [{ type: 'image', image: screenshotDataUrl }],
                  },
                ],
              });
              return response as GeminiResponse;
            } catch (error) {
              console.error('Chunk processing error:', error);
              return { text: '' } as GeminiResponse;
            }
          });

          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults.filter(r => r.text));
        }
        return results;
      })()
    ]);

    let summary = summaryChunks.map((r: GeminiResponse) => r.text).join('\n');

    if (summaryChunks.length > 1) {
      const combinedSummaryChunks = await generateText({
        model: google('gemini-2.0-flash'),
        messages: [
          {
            role: 'user',
            content: `Combine the following steps into a single list of steps to re-create this page:

${summaryChunks
  .map(
    (r: GeminiResponse, i) => `Chunk of steps ${i + 1}:
${r.text}`,
  )
  .join('\n\n')}
`,
          },
        ],
      }) as GeminiResponse;
      summary = combinedSummaryChunks.text;
    }

    const [screenshot, elementMap, serializedTree] = await Promise.all([
      page.screenshot(
        {
          optimizeForSpeed: true,
          quality: 80,
          type: 'jpeg' as const,
          encoding: 'binary' as const,
          omitBackground: true,
        }
      ),
      page.evaluate(() => {
        const estimateTokenCount = (text?: string | undefined) => text ? text.length / 4 : 0;
        let allocatedTokens = 800_000;
        let stringifiedElementMap = '';
        const elementMap = globalThis.ShrinkwrapData.elementMap;

        for (const [id, elements] of elementMap.entries()) {
          let stringPart = `# id: ${id}\n`;
          for (const element of Array.from(elements)) {
            const html = (element as Element).outerHTML;
            const tokens = estimateTokenCount(html);
            if (tokens > allocatedTokens) break;
            allocatedTokens -= tokens;
            stringPart += `## html: ${html}\n`;
          }
          stringifiedElementMap += `${stringPart}\n\n`;
        }
        return stringifiedElementMap.trim();
      }),
      page.evaluate(() => {
        const Bippy = globalThis.Bippy;
        const fiberRoots = Bippy._fiberRoots;
        const root = Array.from(fiberRoots)[0];
        return root ? Bippy.specTree : '';
      })
    ]);

    const { object } = await generateObject({
      model: google('gemini-2.0-flash', { structuredOutputs: true }),
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

Component Tree:
\`\`\`jsx
${serializedTree}
\`\`\`

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
- The reactComponentFunctionDefinition should be a valid React component function. Don't just return the html, return a valid React component function snippet.`,
        },
        {
          role: 'user',
          content: `Element Map: ${elementMap}`,
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

    const response = {
      summary,
      component_info: object,
      palette: palette.map(({ hex }: { hex: string }) => hex),
    };

    if (shouldCloseBrowser) {
      await browser.close();
    }

    return NextResponse.json(response);
  } catch {
    if (browser) {
      await browser.close();
    }
    return NextResponse.json(
      { error: 'Failed to process page' },
      { status: 500 }
    );
  }
};
