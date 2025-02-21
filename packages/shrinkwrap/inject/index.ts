import {
  getFiberFromHostInstance,
  getFiberId,
  getNearestHostFiber,
  getNearestHostFibers,
  getType,
  isCompositeFiber,
  setFiberId,
  traverseFiber,
  type Fiber,
  type FiberRoot,
  _fiberRoots as fiberRoots,
  instrument,
  isInstrumentationActive,
} from 'bippy';
import { registerGlobal } from './puppeteer-utils';
import { getClassStyles, stylesToCSS, type StylesMap } from './styles';
import { TailwindConverter } from 'css-to-tailwindcss';

const converter = new TailwindConverter({
  remInPx: 16,
  tailwindConfig: {
    content: ['./src/**/*.{js,jsx,ts,tsx}'],
    theme: {
      extend: {},
    },
  }
});

const debug = (...args: unknown[]) => {
  console.info('[Shrinkwrap]', ...args);
};

export const findNearestCompositeFibers = (startFiber: Fiber, results: Set<Fiber>) => {
  debug('Finding nearest composite fibers for:', startFiber);
  const stack: Array<{ fiber: Fiber; visited: boolean }> = [
    { fiber: startFiber, visited: false },
  ];

  while (stack.length > 0) {
    const { fiber, visited } = stack[stack.length - 1];

    if (!visited) {
      stack[stack.length - 1].visited = true;

      if (isCompositeFiber(fiber)) {
        results.add(fiber);
        stack.pop();
        continue;
      }

      if (fiber.child) {
        stack.push({ fiber: fiber.child, visited: false });
        continue;
      }
    }

    stack.pop();
    if (fiber.sibling) {
      stack.push({ fiber: fiber.sibling, visited: false });
    }
  }
};

const ShrinkwrapData: {
  elementMap: Map<number, Set<Element>>;
  componentTypeMap: Map<number, Set<object>>;
  fiberRoots: Set<FiberRoot>;
  createComponentMap: typeof createComponentMap | undefined;
  cssSelectors: Record<string, string[]>;
  findNearestCompositeFibers: typeof findNearestCompositeFibers;
  safeComponentMap?: Record<string, {
    html: string;
  }>;
} = {
  elementMap: new Map(),
  componentTypeMap: new Map(),
  fiberRoots,
  createComponentMap: undefined,
  cssSelectors: {},
  findNearestCompositeFibers,
};

registerGlobal('ShrinkwrapData', ShrinkwrapData);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getDpr = () => {
  return Math.min(window.devicePixelRatio || 1, 2);
};

const CANVAS_HTML_STR = `<canvas style="position:fixed;top:0;left:0;pointer-events:none;z-index:2147483646" aria-hidden="true"></canvas>`;

const COLORS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 165, 0],
  [128, 0, 128],
  [0, 128, 128],
  [255, 105, 180],
  [75, 0, 130],
  [255, 69, 0],
  [46, 139, 87],
  [220, 20, 60],
  [70, 130, 180],
];

export const isElementVisible = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  return (
    element.offsetWidth > 0 &&
    element.offsetHeight > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none'
  );
};

export const isTopElement = (element: HTMLElement) => {
  const doc = element.ownerDocument;

  if (doc !== window.document) {
    return true;
  }

  const shadowRoot = element.getRootNode();
  if (shadowRoot instanceof ShadowRoot) {
    const rect = element.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };

    try {
      const topEl = shadowRoot.elementFromPoint(point.x, point.y) as
        | Element
        | ShadowRoot
        | null;
      if (!topEl) return false;

      let current: Element | ShadowRoot | null = topEl;
      while (current && current !== shadowRoot) {
        if (current === element) return true;
        current = current.parentElement;
      }
      return false;
    } catch {
      return true;
    }
  }

  const rect = element.getBoundingClientRect();

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const viewportTop = scrollY;
  const viewportLeft = scrollX;
  const viewportBottom = window.innerHeight + scrollY;
  const viewportRight = window.innerWidth + scrollX;

  const absTop = rect.top + scrollY;
  const absLeft = rect.left + scrollX;
  const absBottom = rect.bottom + scrollY;
  const absRight = rect.right + scrollX;

  if (
    absBottom < viewportTop ||
    absTop > viewportBottom ||
    absRight < viewportLeft ||
    absLeft > viewportRight
  ) {
    return false;
  }

  try {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const point = {
      x: centerX,
      y: centerY,
    };

    if (
      point.x < 0 ||
      point.x >= window.innerWidth ||
      point.y < 0 ||
      point.y >= window.innerHeight
    ) {
      return true;
    }

    const topEl = document.elementFromPoint(point.x, point.y);
    if (!topEl) return false;

    let current: Element | null = topEl;
    while (current && current !== document.documentElement) {
      if (current === element) return true;
      current = current.parentElement;
    }
    return false;
  } catch {
    return true;
  }
};

export const getRectMap = (
  elements: Element[],
): Promise<Map<Element, DOMRect>> => {
  return new Promise((resolve) => {
    const rects = new Map<Element, DOMRect>();
    const observer = new IntersectionObserver((entries) => {
      for (let i = 0, len = entries.length; i < len; i++) {
        const entry = entries[i];
        const element = entry.target;
        const rect = entry.boundingClientRect;
        if (entry.isIntersecting && rect.width && rect.height) {
          rects.set(element, rect);
        }
      }
      observer.disconnect();
      resolve(rects);
    });

    for (let i = 0, len = elements.length; i < len; i++) {
      const element = elements[i];
      observer.observe(element);
    }
  });
};

export const clear = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
) => {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
};

export const draw = async (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  elements: Element[],
) => {
  const dpr = getDpr();
  const rectMap = await getRectMap(elements);
  clear(ctx, canvas, dpr);

  const drawnLabelBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];
  const visibleIndices = new Map<Element, number>();
  const objectFiberTypeMap = new WeakMap<object, number>();
  const stringFiberTypeMap = new Map<string, number>();
  let typeCount = 0;

  ShrinkwrapData.elementMap.clear();
  ShrinkwrapData.componentTypeMap.clear();
  ShrinkwrapData.safeComponentMap = {};

  const getTypeIndex = (type: string | object) => {
    if (typeof type === 'string') {
      let index = stringFiberTypeMap.get(type);
      if (index === undefined) {
        index = typeCount++;
        stringFiberTypeMap.set(type, index);
      }
      return index;
    }

    let index = objectFiberTypeMap.get(type);
    if (index === undefined) {
      index = typeCount++;
      objectFiberTypeMap.set(type, index);
    }
    return index;
  };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const COVERAGE_THRESHOLD = 0.97;

  const visibleElements = new Set<Element>();

  for (let i = 0, len = elements.length; i < len; i++) {
    const element = elements[i];
    const rect = rectMap.get(element);
    if (!rect) continue;

    const fiber = getFiberFromHostInstance(element);
    if (!fiber?.type) continue;

    const fiberType = getType(fiber) || fiber.type;
    const typeIndex = getTypeIndex(fiberType);
    const { width, height } = rect;
    const x = rect.x;
    const y = rect.y;

    if (
      width / viewportWidth > COVERAGE_THRESHOLD &&
      height / viewportHeight > COVERAGE_THRESHOLD
    )
      continue;

    const text = `${typeIndex + 1}`;
    const textSize = 16;
    ctx.textRendering = 'optimizeSpeed';
    ctx.font = `${textSize}px monospace`;
    const { width: textWidth } = ctx.measureText(text);

    let labelY: number = y - textSize - 4;
    if (labelY < 0) {
      labelY = 0;
    }

    const labelBounds = {
      x,
      y: labelY,
      width: textWidth + 4,
      height: textSize + 4,
    };

    const hasCollision = drawnLabelBounds.some(
      (bound) =>
        labelBounds.x < bound.x + bound.width &&
        labelBounds.x + labelBounds.width > bound.x &&
        labelBounds.y < bound.y + bound.height &&
        labelBounds.y + labelBounds.height > bound.y,
    );

    if (!hasCollision) {
      drawnLabelBounds.push(labelBounds);
      visibleIndices.set(element, typeIndex + 1);
      visibleElements.add(element);

      const elementId = typeIndex + 1;
      const elementSet =
        ShrinkwrapData.elementMap.get(elementId) || new Set<Element>();
      elementSet.add(element);
      ShrinkwrapData.elementMap.set(elementId, elementSet);

      ctx.beginPath();
      ctx.rect(x, y, width, height);
      const color = COLORS[typeIndex % COLORS.length].join(',');
      ctx.fillStyle = `rgba(${color},0.1)`;
      ctx.strokeStyle = `rgba(${color})`;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = `rgba(${color})`;
      ctx.fillRect(x, labelY, textWidth + 4, textSize + 4);
      ctx.fillStyle = 'rgba(255,255,255)';
      ctx.fillText(text, x + 2, labelY + textSize);
    }
  }

  for (const element of visibleElements) {
    const fiber = getFiberFromHostInstance(element);
    if (!fiber?.type) continue;

    const fiberType = getType(fiber) || fiber.type;
    const typeIndex = getTypeIndex(fiberType);
    const elementId = typeIndex + 1;
    const componentId = elementId.toString();

    if (!ShrinkwrapData.safeComponentMap[componentId]) {
      const processElement = async (el: Element): Promise<string> => {
        const tailwindClasses = new Set<string>();

        const normalStyles = getClassStyles(el);
        const cssString = `.converted-element{${stylesToCSS(normalStyles)}}`;

        try {
          const { nodes } = await converter.convertCSS(cssString);
          debug('Normal styles:', {
            element: el.tagName,
            styles: normalStyles,
            convertedClasses: nodes?.[0]?.tailwindClasses || []
          });

          if (nodes?.[0]?.tailwindClasses) {
            for (const cls of nodes[0].tailwindClasses) {
              if (!cls.includes('undefined') && !cls.includes('NaN')) {
                tailwindClasses.add(cls);
              }
            }
          }

          const hoverStyles = getClassStyles(el, ':hover');
          const diffHoverStyles: StylesMap = {};

          for (const [prop, value] of Object.entries(hoverStyles)) {
            if (value !== normalStyles[prop]) {
              diffHoverStyles[prop] = value;
            }
          }

          if (Object.keys(diffHoverStyles).length > 0) {
            const hoverCss = `.converted-element:hover{${stylesToCSS(diffHoverStyles)}}`;
            const { nodes: hoverNodes } = await converter.convertCSS(hoverCss);
            debug('Hover styles:', {
              element: el.tagName,
              styles: diffHoverStyles,
              classes: hoverNodes?.[0]?.tailwindClasses || []
            });

            if (hoverNodes?.[0]?.tailwindClasses) {
              for (const cls of hoverNodes[0].tailwindClasses) {
                if (cls.startsWith('hover:') && !cls.includes('undefined') && !cls.includes('NaN')) {
                  tailwindClasses.add(cls);
                }
              }
            }
          }
        } catch (error) {
          debug('Error converting styles to Tailwind:', error);
        }

        const childrenHTML = await Promise.all(
          Array.from(el.children).map(child => processElement(child))
        );

        const textContent = Array.from(el.childNodes)
          .filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent)
          .join('')
          .trim();

        const tag = el.tagName.toLowerCase();
        const attrs = Array.from(el.attributes)
          .filter(attr => attr.name !== 'class')
          .map(attr => `${attr.name}="${attr.value}"`)
          .join(' ');

        const classString = Array.from(tailwindClasses).join(' ');
        return `<${tag}${classString ? ` class="${classString}"` : ''}${attrs ? ` ${attrs}` : ''}>${textContent}${childrenHTML.join('')}</${tag}>`;
      };

      const html = await processElement(element);
      ShrinkwrapData.safeComponentMap[componentId] = { html };

      debug('Processed component:', {
        id: componentId,
        tag: element.tagName.toLowerCase()
      });
    }
  }

  return visibleIndices;
};

export const createComponentMap = (fiberRoot: FiberRoot) => {
  debug('Starting component map creation for fiber root:', fiberRoot);

  const componentKeyMap = new Map<number, object>();
  const componentMap = new Map<
    object,
    {
      elements: WeakSet<Element>;
      childrenComponents: WeakSet<object>;
    }
  >();

  let componentCount = 0;

  traverseFiber(fiberRoot.current, (fiber) => {
    if (!isCompositeFiber(fiber)) return;

    const type = getType(fiber) || fiber.type;
    if (!type) return;

    componentCount++;
    debug('Found component:', {
      count: componentCount,
      type: typeof type === 'function' ? type.name : type,
      hasElements: fiber.stateNode instanceof Element
    });

    componentKeyMap.set(componentKeyMap.size, type);

    if (!componentMap.has(type)) {
      componentMap.set(type, {
        elements: new WeakSet(),
        childrenComponents: new WeakSet(),
      });
    }

    const component = componentMap.get(type);
    if (!component) return;

    const hostFibers = getNearestHostFibers(fiber);
    debug('Found host fibers:', hostFibers.length);

    for (const hostFiber of hostFibers) {
      if (hostFiber.stateNode instanceof Element) {
        component.elements.add(hostFiber.stateNode);
      }
    }

    const compositeFibers = new Set<Fiber>();
    if (fiber.child) {
      findNearestCompositeFibers(fiber.child, compositeFibers);
    }

    debug('Found child components:', compositeFibers.size);

    for (const compositeFiber of compositeFibers) {
      const childType = getType(compositeFiber) || compositeFiber.type;
      if (childType) {
        component.childrenComponents.add(childType);
      }
    }
  });

  debug('Component map creation complete:', {
    totalComponents: componentCount,
    componentsWithElements: componentMap.size
  });

  return { componentMap, componentKeyMap };
};

ShrinkwrapData.createComponentMap = createComponentMap;

let ctx: CanvasRenderingContext2D | null = null;
let canvas: HTMLCanvasElement | null = null;

const handleFiberRoot = (root: FiberRoot) => {
  const elements = new Set<Element>();
  traverseFiber(root.current, (fiber) => {
    setFiberId(fiber, getFiberId(fiber));
    if (!isCompositeFiber(fiber)) {
      return;
    }
    const hostFiber = getNearestHostFiber(fiber);
    if (
      !hostFiber ||
      !isElementVisible(hostFiber.stateNode) ||
      !isTopElement(hostFiber.stateNode)
    )
      return;
    elements.add(hostFiber.stateNode);
  });
  return elements;
};

const init = () => {
  const host = document.createElement('div');
  host.setAttribute('data-shrinkwrap', 'true');
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = CANVAS_HTML_STR;
  canvas = root.firstChild as HTMLCanvasElement;

  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  const { innerWidth, innerHeight } = window;
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  const width = innerWidth * dpr;
  const height = innerHeight * dpr;
  canvas.width = width;
  canvas.height = height;

  ctx = canvas.getContext('2d', { alpha: true });
  if (ctx) {
    ctx.scale(dpr, dpr);
  }

  root.appendChild(canvas);

  document.documentElement.appendChild(host);

  let isAnimationScheduled = false;
  const resizeHandler = () => {
    if (!isAnimationScheduled) {
      isAnimationScheduled = true;
      requestAnimationFrame(() => {
        if (!canvas) return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        dpr = getDpr();
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        if (ctx) {
          ctx.resetTransform();
          ctx.scale(dpr, dpr);
        }
        const elements = new Set<Element>();
        for (const root of Array.from(fiberRoots)) {
          for (const element of Array.from(handleFiberRoot(root))) {
            elements.add(element);
          }
        }
        if (ctx && canvas) {
          draw(ctx, canvas, Array.from(elements));
        }
        isAnimationScheduled = false;
      });
    }
  };

  const scrollHandler = () => {
    if (!isAnimationScheduled) {
      isAnimationScheduled = true;
      requestAnimationFrame(() => {
        const elements = new Set<Element>();
        for (const root of Array.from(fiberRoots)) {
          for (const element of Array.from(handleFiberRoot(root))) {
            elements.add(element);
          }
        }
        if (ctx && canvas) {
          draw(ctx, canvas, Array.from(elements));
        }
        isAnimationScheduled = false;
      });
    }
  };

  window.addEventListener('wheel', scrollHandler);
  window.addEventListener('scroll', scrollHandler);
  window.addEventListener('resize', resizeHandler);

  for (const root of Array.from(fiberRoots)) {
    const elements = handleFiberRoot(root);
    if (ctx && canvas) {
      draw(ctx, canvas, Array.from(elements));
    }
  }

  return () => {
    window.removeEventListener('wheel', scrollHandler);
    window.removeEventListener('scroll', scrollHandler);
    window.removeEventListener('resize', resizeHandler);
  };
};

let hasPageLoaded = false;
const loadListeners = new Set<() => void>();
window.addEventListener('load', async () => {
  hasPageLoaded = true;
  // average LCP (2.5s) - 500ms buffer time
  await delay(2000);
  if (isInstrumentationActive()) {
    init();
    for (const listener of loadListeners) {
      listener();
    }
  } else {
    console.error('Page is not using React');
  }
});

instrument({
  onCommitFiberRoot(_, root) {
    fiberRoots.add(root);
    const handle = () => {
      const elements = handleFiberRoot(root);
      if (ctx && canvas) {
        draw(ctx, canvas, Array.from(elements));
      }
    };
    if (!hasPageLoaded) {
      loadListeners.add(handle);
    } else {
      handle();
    }
  },
});
