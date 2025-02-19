import { type NextRequest, NextResponse } from 'next/server';
import { google } from '@ai-sdk/google';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { Page, Browser } from 'puppeteer-core';
import { TailwindConverter } from 'css-to-tailwindcss';
import postcss from 'postcss';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const CHROMIUM_PATH = 'https://fs.bippy.dev/chromium.tar';
const BIPPY_SOURCE = process.env.BIPPY_SOURCE as string;
const EXTRACT_COLORS_SOURCE = process.env.EXTRACT_COLORS_SOURCE as string;
const INJECT_SOURCE = process.env.INJECT_SOURCE as string;

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
  const { url, prompt } = await request.json();
  const page = (await browser.newPage()) as Page;

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

  const scripts = [BIPPY_SOURCE, EXTRACT_COLORS_SOURCE, INJECT_SOURCE];

  await page.evaluateOnNewDocument(scripts.join('\n\n'));

  await page.goto(url, { waitUntil: ['domcontentloaded', 'load'] });

  const cssSelectors: Record<string, string[]> = {};

  const rules = Array.from(stylesheets.values());

  await Promise.all(
    rules.map(async (rawCSS) => {
      try {
        const strippedCSS = stripCSSKeyframes(rawCSS);
        const { nodes } = await converter.convertCSS(strippedCSS);
        for (const node of nodes) {
          cssSelectors[node.rule.selector] = node.tailwindClasses;
        }
      } catch {}
    }),
  );

  const title = await page.title();
  const description = await page.evaluate(() => {
    return document
      .querySelector('meta[name="description"]')
      ?.getAttribute('content');
  });

  const html = await page.content();
  const body = await page.evaluate(() => {
    const bodyClone = document.body.cloneNode(true) as HTMLElement;

    const elementsToRemove = bodyClone.querySelectorAll(
      'script, link, style, noscript, iframe, [aria-hidden="true"], .hidden, [hidden]',
    );
    for (const el of elementsToRemove) {
      el.remove();
    }

    const removeEmpty = (element: HTMLElement) => {
      for (const child of element.children) {
        if (child instanceof HTMLElement) {
          removeEmpty(child);
        }
      }

      if (!element.innerHTML.trim() && element.parentElement) {
        element.remove();
      }
    };

    removeEmpty(bodyClone);

    return bodyClone.innerHTML.trim();
  });

  const bodyChunks: string[] = [];

  // Chunk the body by approximately 900,000 tokens (text.length / 4 = tokens)
  const chunkSize = 900000 * 4;
  for (let i = 0; i < body.length; i += chunkSize) {
    bodyChunks.push(body.slice(i, i + chunkSize));
  }

  const rawScreenshot = await page.screenshot({
    optimizeForSpeed: true,
    quality: 80,
    type: 'jpeg',
  });
  const rawScreenshotDataUrl = convertBufferToDataUrl(
    rawScreenshot,
    'image/jpeg',
  );

  const palette = await page.evaluate((rawScreenshotDataUrl) => {
    // biome-ignore lint/suspicious/noExplicitAny: OK
    const extractColors = (globalThis as any).extractColors;
    const img = new Image();
    img.src = rawScreenshotDataUrl;
    const colors = extractColors(img);
    return colors;
  }, rawScreenshotDataUrl);

  const summaryChunks = await Promise.all(
    bodyChunks.map((bodyChunk) =>
      generateText({
        model: google('gemini-2.0-flash'),
        messages: [
          {
            role: 'user',
            content: `Page: ${url}
Title: ${title}
Description: ${description}

\`\`\`html
${bodyChunk}
\`\`\`

Provide a concise list of steps to re-create this page. Only return the steps, no other text.
`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'image',
                image: rawScreenshotDataUrl,
              },
            ],
          },
        ],
      }),
    ),
  );

  let summary = summaryChunks.map((r) => r.text).join('\n');

  if (summaryChunks.length > 1) {
    const combinedSummaryChunks = await generateText({
      model: google('gemini-2.0-flash'),
      messages: [
        {
          role: 'user',
          content: `Combine the following steps into a single list of steps to re-create this page:

${summaryChunks
  .map(
    (r, i) => `Chunk of steps ${i + 1}:
${r.text}`,
  )
  .join('\n\n')}
`,
        },
      ],
    });
    summary = combinedSummaryChunks.text;
  }

  await delay(1000);

  const screenshot = await page.screenshot({
    optimizeForSpeed: true,
    quality: 80,
    type: 'jpeg',
  });

  const replacements: Record<string, string> = {};

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

  const serializedTree = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: OK
    const Bippy = (globalThis as any).Bippy;
    const fiberRoots = Bippy._fiberRoots;
    const root = Array.from(fiberRoots)[0];
    if (!root) return '';

    return Bippy.specTree;
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

  return NextResponse.json({
    summary,
    component_info: object,
    // meta: {
    //   title,
    //   description,
    //   prompt,
    // },
    // code: {
    //   replacements,
    // },
    palette: palette.map(({ hex }: { hex: string }) => hex),
    // screenshot: convertBufferToDataUrl(screenshot, 'image/jpeg'),
  });
};
