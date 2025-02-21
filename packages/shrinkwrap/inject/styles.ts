export type StylesMap = Record<string, string>;

let blankIframe: HTMLIFrameElement | undefined;

export const getStylesIframe = (): HTMLIFrameElement => {
  if (blankIframe) {
    return blankIframe;
  }

  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  blankIframe = iframe;

  return iframe;
};

export const getStylesObject = (
  node: Element,
  parentWindow: Window,
  pseudoClass?: string
): StylesMap => {
  const styles = parentWindow.getComputedStyle(node, pseudoClass || null);
  const stylesObject: StylesMap = {};

  for (let i = 0; i < styles.length; i++) {
    const property = styles[i];
    const value = styles.getPropertyValue(property);
    stylesObject[property] = value;
  }

  return stylesObject;
};

export const getDefaultStyles = (node: Element): StylesMap => {
  const iframe = getStylesIframe();
  const iframeDocument = iframe.contentDocument;
  if (!iframeDocument) {
    throw new Error('Failed to get iframe document');
  }

  const targetElement = iframeDocument.createElement(node.tagName);
  iframeDocument.body.appendChild(targetElement);

  const contentWindow = iframe.contentWindow;
  if (!contentWindow) {
    targetElement.remove();
    throw new Error('Failed to get iframe window');
  }

  const defaultStyles = getStylesObject(targetElement, contentWindow);
  targetElement.remove();

  return defaultStyles;
};

export const getInlineStyles = (node: Element): StylesMap => {
  const stylesObject: StylesMap = {};
  if (node instanceof HTMLElement && node.style) {
    const style = node.style;
    for (let i = 0; i < style.length; i++) {
      const property = style[i];
      const value = style.getPropertyValue(property);
      if (value) {
        stylesObject[property] = value;
      }
    }
  }
  return stylesObject;
};

export const getUserStyles = (node: Element, pseudoClass?: string): StylesMap => {
  const defaultStyles = getDefaultStyles(node);
  const computedStyles = pseudoClass
    ? getStylesObject(node, window, pseudoClass)
    : getStylesObject(node, window);
  const inlineStyles = getInlineStyles(node);
  const userStyles: StylesMap = {};

  for (const property in computedStyles) {
    const value = computedStyles[property];
    const defaultValue = defaultStyles[property];

    if (value === defaultValue ||
      value === 'none' ||
      value === 'auto' ||
      value === '0px' ||
      value === 'normal' ||
      value === 'rgb(0, 0, 0)' ||
      value === 'rgba(0, 0, 0, 0)') {
      continue;
    }

    userStyles[property] = value;
  }

  Object.assign(userStyles, inlineStyles);

  return userStyles;
};

export const stylesToCSS = (styles: StylesMap): string => {
  return Object.entries(styles)
    .map(([property, value]) => `${property}: ${value};`)
    .join(' ');
};

export const splitClassName = (className: string) => {
  return className.match(/\S+/g) || [];
};

export const getWindowDefaultStyles = (node: Element): StylesMap => {
  const tempElement = document.createElement(node.tagName);
  document.body.appendChild(tempElement);

  const windowStyles = window.getComputedStyle(tempElement);
  const defaultStyles: StylesMap = {};

  for (let i = 0; i < windowStyles.length; i++) {
    const property = windowStyles[i];
    const value = windowStyles.getPropertyValue(property);
    defaultStyles[property] = value;
  }

  tempElement.remove();
  return defaultStyles;
};

const INHERITABLE_PROPERTIES = new Set([
  'border-collapse',
  'border-spacing',
  'caption-side',
  'color',
  'cursor',
  'direction',
  'empty-cells',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'font',
  'letter-spacing',
  'line-height',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'list-style',
  'text-align',
  'text-indent',
  'text-transform',
  'visibility',
  'white-space',
  'word-spacing'
]);

export const getClassStyles = (node: Element, pseudoClass?: string): StylesMap => {
  const windowDefaults = getWindowDefaultStyles(node);

  const computedStyles = window.getComputedStyle(node, pseudoClass || null);
  const classStyles: StylesMap = {};

  for (let i = 0; i < computedStyles.length; i++) {
    const property = computedStyles[i];
    const value = computedStyles.getPropertyValue(property);
    const defaultValue = windowDefaults[property];

    if (!INHERITABLE_PROPERTIES.has(property) &&
      value === defaultValue ||
      (value !== 'inherit' && (
        value === 'none' ||
        value === 'auto' ||
        value === '0px' ||
        value === 'normal' ||
        value === 'rgb(0, 0, 0)' ||
        value === 'rgba(0, 0, 0, 0)'
      ))) {
      continue;
    }

    classStyles[property] = value;
  }

  return classStyles;
};
