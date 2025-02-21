import { type NextRequest, NextResponse } from 'next/server';
import { google } from '@ai-sdk/google';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { Page, Browser } from 'puppeteer-core';
import { TailwindConverter } from 'css-to-tailwindcss';
import postcss from 'postcss';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CoreMessage } from 'ai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

let cachedInjectSource: string | undefined;

const loadSources = async () => {
  if (process.env.NODE_ENV === 'development') {
    const [injectSource] = await Promise.all([
      fs.readFile(
        path.join(process.cwd(), 'inject/dist/index.global.js'),
        'utf-8',
      ),
    ]);
    return { injectSource };
  }

  if (cachedInjectSource) {
    return { injectSource: cachedInjectSource };
  }

  const [injectSource] = await Promise.all([
    fs.readFile(
      path.join(process.cwd(), 'inject/dist/index.global.js'),
      'utf-8',
    ),
  ]);

  cachedInjectSource = injectSource;

  return { injectSource };
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
  // Cast the development browser to match production type
  return (await puppeteer.launch({
    defaultViewport: null,
    args: CHROMIUM_ARGS,
    headless: false,
  })) as unknown as Browser;
};

export const POST = async (request: NextRequest) => {
  const { injectSource } = await loadSources();

  if (!injectSource) {
    return NextResponse.json(
      { error: 'Failed to inject sources' },
      { status: 500 },
    );
  }

  const browser = await getBrowser();
  const { url, prompt } = await request.json();

  // Get the default page instead of creating a new one
  const page = (await browser.pages())[0] as Page;

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

  await page.evaluateOnNewDocument(injectSource);

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

  await page.evaluate((cssSelectors) => {
    // biome-ignore lint/suspicious/noExplicitAny: OK
    const ShrinkwrapData = (globalThis as any).ShrinkwrapData;
    ShrinkwrapData.cssSelectors = cssSelectors;
  }, cssSelectors);

  const title = await page.title();
  const description = await page.evaluate(() => {
    return document
      .querySelector('meta[name="description"]')
      ?.getAttribute('content');
  });

  // const snapshot = await page.accessibility.snapshot();

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
  const maxChunkSize = 900000 * 3; // Reduced to account for CSS content

  // Convert CSS selectors to string format
  const cssSelectorsString = Object.entries(cssSelectors)
    .map(([selector, classes]) => `${selector} { ${classes.join(' ')} }`)
    .join('\n');

  if (body.length + cssSelectorsString.length <= maxChunkSize) {
    bodyChunks.push(body);
  } else {
    // Calculate optimal number of chunks needed, accounting for CSS content
    const totalLength = body.length;
    const numChunks = Math.ceil(
      totalLength / (maxChunkSize - cssSelectorsString.length),
    );
    const targetChunkSize = Math.ceil(totalLength / numChunks);

    for (let i = 0; i < numChunks; i++) {
      const start = i * targetChunkSize;
      const end = Math.min((i + 1) * targetChunkSize, totalLength);
      bodyChunks.push(body.slice(start, end));
    }
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

  const hexColors = palette.map(({ hex }: { hex: string }) => hex);

  const generatePageDescription = async (
    params: {
      url: string;
      title: string;
      description: string | null | undefined;
      cssSelectorsString: string;
      bodyChunk: string;
      hexColors: string[];
      rawScreenshotDataUrl: string;
    },
    isInitialRequest = true,
    previousSteps = '',
  ) => {
    const model = google('gemini-2.0-flash-thinking-exp-01-21');
    const basePrompt = `Page: ${params.url}
Title: ${params.title}
Description: ${params.description || 'No description available'}

Color palette: ${params.hexColors.join(', ')}`;

    const response = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: isInitialRequest
            ? `${basePrompt}

CSS Stylesheets:

\`\`\`css
${params.cssSelectorsString}
\`\`\`

HTML Body:

\`\`\`html
${params.bodyChunk}
\`\`\`

You are an expert at recreating web pages. Provide a list of steps to re-create this page. Describe each step (styles, positioning, structure) such that a human can reconstruct the ENTIRE page with pixel-perfect accuracy. Only return the steps, no other text. Say "<PAGE_COMPLETE>" if you have described all the steps.`
            : `${basePrompt}

Previous steps:
${previousSteps}

Look at the image and the previous steps carefully. Are there any visible UI elements, sections, or components that haven't been described in the steps yet? If yes, continue listing ONLY the missing steps. If no, respond with "<PAGE_COMPLETE>". Be thorough - check navigation, footers, sidebars, and any interactive elements.`,
        },
        {
          role: 'user',
          content: params.rawScreenshotDataUrl,
        },
      ],
    });

    const text = response.text;
    if (typeof text !== 'string') return '';
    return text.trim();
  };

  const processPageChunk = async (params: {
    url: string;
    title: string;
    description: string | null | undefined;
    cssSelectorsString: string;
    bodyChunk: string;
    hexColors: string[];
    rawScreenshotDataUrl: string;
  }) => {
    const initialResponse = await generatePageDescription(params);
    let fullText = initialResponse;

    if (fullText.includes('<PAGE_COMPLETE>')) {
      return fullText.replace('<PAGE_COMPLETE>', '').trim();
    }

    const MAX_CONTINUATION_ATTEMPTS = 3;
    let attempts = 0;

    while (attempts < MAX_CONTINUATION_ATTEMPTS) {
      attempts++;
      const continuationText = await generatePageDescription(params, false, fullText);

      if (continuationText === '<PAGE_COMPLETE>') {
        break;
      }

      fullText = `${fullText}\n${continuationText}`;
    }

    return fullText;
  };

  const summaryChunks = await Promise.all(
    bodyChunks.map(async (bodyChunk) => ({
      text: await processPageChunk({
        url,
        title,
        description,
        cssSelectorsString,
        bodyChunk,
        hexColors,
        rawScreenshotDataUrl,
      }),
    })),
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

  // average LCP: 2.5s
  await delay(2500);

  const annotatedScreenshot = await page.screenshot({
    optimizeForSpeed: true,
    quality: 80,
    type: 'jpeg',
  });

  // const classes = await page.evaluate(() => {
  //   const classesMap: Record<string, string[]> = {};
  //   // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  //   const ShrinkwrapData = (globalThis as any).ShrinkwrapData;
  //   for (const [selector, classes] of ShrinkwrapData.cssSelectors.entries()) {

  //   }

  //   return classesMap;
  // });

  const safeComponentMap = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const ShrinkwrapData = (globalThis as any).ShrinkwrapData;

    const safeComponentMap: Record<
      string,
      { html: string; childrenComponents: number[] }
    > = {};

    for (const fiberRoot of ShrinkwrapData.fiberRoots) {
      const { componentMap, componentKeyMap } =
        ShrinkwrapData.createComponentMap(fiberRoot);

      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      const invertedComponentTypeMap = new WeakMap<any, number>();

      for (const [key, value] of ShrinkwrapData.componentTypeMap.entries()) {
        for (const type of value) {
          invertedComponentTypeMap.set(type, key);
        }
      }

      for (const [key, value] of ShrinkwrapData.componentTypeMap.entries()) {
        for (const type of value) {
          const { elements, childrenComponents: rawChildrenComponents } =
            componentMap.get(type);
          if (!elements.size) continue;
          let html = '';

          for (const element of elements) {
            html += element.outerHTML;
          }

          const childrenComponents: number[] = [];
          for (const rawChildComponent of rawChildrenComponents) {
            if (invertedComponentTypeMap.has(rawChildComponent)) {
              // basically need to get the key of the value:
              childrenComponents.push(
                invertedComponentTypeMap.get(rawChildComponent) as number,
              );
            }
          }
          safeComponentMap[key] = {
            html,
            childrenComponents,
          };
        }
      }
    }
    return safeComponentMap;
  });

  console.log(safeComponentMap);

  //   const stringifiedElementMap = await page.evaluate(() => {
  //     // https://x.com/theo/status/1889972653785764084
  //     const estimateTokenCount = (text?: string | undefined) => {
  //       if (!text) return 0;
  //       return text.length / 4;
  //     };

  //     let allocatedTokens = 800_000;
  //     let stringifiedElementMap = '';

  //     // biome-ignore lint/suspicious/noExplicitAny: OK
  //     const elementMap = (globalThis as any).ShrinkwrapData.elementMap;

  //     for (const [id, elements] of elementMap.entries()) {
  //       let stringPart = `# id: ${id}\n`;
  //       for (const element of Array.from(elements)) {
  //         const html = (element as Element).outerHTML;
  //         const tokens = estimateTokenCount(html);
  //         if (tokens > allocatedTokens) {
  //           break;
  //         }
  //         allocatedTokens -= tokens;
  //         stringPart += `## html: ${html}\n`;
  //       }
  //       stringifiedElementMap += `${stringPart}\n\n`;
  //     }

  //     return stringifiedElementMap.trim();
  //   });

  const annotatedResult = await generateObject({
    model: google('gemini-2.0-flash', { structuredOutputs: true }),
    schema: z.array(
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
      }),
    ),
    messages: [
      {
        role: 'user',
        content: `Page: ${url}
  Title: ${title}
  Description: ${description}

  Summary of how to recreate the page:
  ${summary}

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
  - Be careful, do not assume a components role, look through the page exhaustively`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image',
            image: annotatedScreenshot,
          },
        ],
      },
    ],
  });

  if (shouldCloseBrowser) {
    await browser.close();
  }

  return NextResponse.json({
    summary,
    component_info: annotatedResult.object,
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
