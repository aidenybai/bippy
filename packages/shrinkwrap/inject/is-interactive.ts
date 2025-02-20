import { getFiberFromHostInstance } from 'bippy';

const interactiveElements = [
  'a',
  'button',
  'details',
  'embed',
  'input',
  'label',
  'menu',
  'menuitem',
  'object',
  'select',
  'textarea',
  'summary',
];

const interactiveRoles = [
  'button',
  'menu',
  'menuitem',
  'link',
  'checkbox',
  'radio',
  'slider',
  'tab',
  'tabpanel',
  'textbox',
  'combobox',
  'grid',
  'listbox',
  'option',
  'progressbar',
  'scrollbar',
  'searchbox',
  'switch',
  'tree',
  'treeitem',
  'spinbutton',
  'tooltip',
  'a-button-inner',
  'a-dropdown-button',
  'click',
  'menuitemcheckbox',
  'menuitemradio',
  'a-button-text',
  'button-text',
  'button-icon',
  'button-icon-only',
  'button-text-icon-only',
  'dropdown',
  'combobox',
];

const interactiveEvents = [
  'click',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
  'keydown',
  'keyup',
  'focus',
  'blur',
];

export const isScrollable = (element: Element) => {
  const isScrollable =
    element.hasAttribute('aria-scrollable') ||
    element.hasAttribute('scrollable') ||
    ('style' in element &&
      ((element.style as CSSStyleDeclaration).overflow === 'auto' ||
        (element.style as CSSStyleDeclaration).overflow === 'scroll' ||
        (element.style as CSSStyleDeclaration).overflowY === 'auto' ||
        (element.style as CSSStyleDeclaration).overflowY === 'scroll' ||
        (element.style as CSSStyleDeclaration).overflowX === 'auto' ||
        (element.style as CSSStyleDeclaration).overflowX === 'scroll'));

  return isScrollable;
};

export const isInteractive = (element: Element) => {
  const fiber = getFiberFromHostInstance(element);

  if (fiber?.stateNode instanceof Element) {
    for (const propName of Object.keys(fiber.memoizedProps || {})) {
      if (!propName.startsWith('on')) continue;
      const event = propName
        .slice(2)
        .toLowerCase()
        .replace(/capture$/, '');
      if (!interactiveEvents.includes(event)) continue;
      if (fiber.memoizedProps[propName]) {
        return true;
      }
    }
  }

  for (const event of interactiveEvents) {
    const dotOnHandler = element[`on${event}` as keyof typeof element];
    const explicitOnHandler = element.hasAttribute(`on${event}`);
    const ngClick = element.hasAttribute(`ng-${event}`);
    const atClick = element.hasAttribute(`@${event}`);
    const vOnClick = element.hasAttribute(`v-on:${event}`);

    if (dotOnHandler || explicitOnHandler || ngClick || atClick || vOnClick) {
      return true;
    }
  }

  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  const ariaRole = element.getAttribute('aria-role');
  const tabIndex = element.getAttribute('tabindex');

  const hasInteractiveRole =
    interactiveElements.includes(tagName) ||
    (role && interactiveRoles.includes(role)) ||
    (ariaRole && interactiveRoles.includes(ariaRole)) ||
    (tabIndex !== null && tabIndex !== '-1');

  const hasAriaProps =
    element.hasAttribute('aria-expanded') ||
    element.hasAttribute('aria-pressed') ||
    element.hasAttribute('aria-selected') ||
    element.hasAttribute('aria-checked');

  const isFormRelated =
    ('form' in element && element.form !== undefined) ||
    element.hasAttribute('contenteditable');

  const isDraggable =
    ('draggable' in element && element.draggable) ||
    element.getAttribute('draggable') === 'true';

  return hasInteractiveRole || isFormRelated || isDraggable || hasAriaProps;
};
