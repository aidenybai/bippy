type StylesMap = Record<string, string>;

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
): StylesMap => {
  const styles = parentWindow.getComputedStyle(node);
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

export const getUserStyles = (node: Element): StylesMap => {
  const defaultStyles = getDefaultStyles(node);
  const styles = getStylesObject(node, window);
  const userStyles: StylesMap = {};

  for (const property in defaultStyles) {
    if (styles[property] !== defaultStyles[property]) {
      userStyles[property] = styles[property];
    }
  }

  return userStyles;
};

export const splitClassName = (className: string) => {
  return className.match(/\S+/g) || [];
};
