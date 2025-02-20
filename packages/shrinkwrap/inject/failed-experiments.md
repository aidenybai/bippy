```js

const isNonsensicalName = (name: string): boolean => {
  // Match single uppercase letters, dollar signs followed by anything, or pure symbols
  return (
    /^[A-Z]$/.test(name) || /^\$/.test(name) || /^[^a-zA-Z0-9]+$/.test(name)
  );
};

const stripRepeatingUnknowns = (specNode: SpecNode): SpecNode => {
  const displayName = Bippy.getDisplayName(specNode.fiber.type) || 'Unknown';

  // Case 1: Strip repeating Unknowns
  if (
    displayName === 'Unknown' &&
    specNode.children.length === 1 &&
    Bippy.getDisplayName(specNode.children[0].fiber.type) === 'Unknown'
  ) {
    return stripRepeatingUnknowns(specNode.children[0]);
  }

  // Case 2: Strip nonsensical names
  if (
    isNonsensicalName(displayName) &&
    specNode.children.length === 1 &&
    isNonsensicalName(
      Bippy.getDisplayName(specNode.children[0].fiber.type) || 'Unknown',
    )
  ) {
    return stripRepeatingUnknowns(specNode.children[0]);
  }

  return {
    fiber: specNode.fiber,
    children: specNode.children.map(stripRepeatingUnknowns),
  };
};

export const serializeSpecTree = async (
  node: SpecNode,
  replacements: Record<string, { html: string; src: string | undefined }> = {},
) => {
  // Strip repeating Unknowns before serialization
  const processedNode = stripRepeatingUnknowns(node);

  const serializeProps = (fiber: Fiber) => {
    let result = '';
    Bippy.traverseProps(fiber, (key, value) => {
      if (key === 'children') return;
      if (typeof value === 'string') {
        result += ` ${key}="${value}"`;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        result += ` ${key}={${value}}`;
      } else if (value === null || value === undefined) {
        result += ` ${key}={${String(value)}}`;
      } else if (typeof value === 'object') {
        result += ` ${key}={${JSON.stringify(value)}}`;
      } else if (typeof value === 'function') {
        result += ` ${key}={/* function */}`;
      }
    });
    return result;
  };

  const serialize = async (specNode: SpecNode): Promise<string> => {
    const { fiber } = specNode;
    const displayName = Bippy.getDisplayName(fiber.type) || 'Unknown';
    const props = Bippy.isHostFiber(fiber) ? serializeProps(fiber) : '';

    // Handle all media elements
    if (fiber.stateNode instanceof Element) {
      if (
        fiber.stateNode instanceof SVGElement ||
        fiber.stateNode instanceof HTMLImageElement ||
        fiber.stateNode instanceof HTMLVideoElement ||
        fiber.stateNode instanceof HTMLAudioElement
      ) {
        const content = fiber.stateNode.outerHTML;
        const hash =
          Math.random().toString(36).substring(2, 15) +
          Math.random().toString(36).substring(2, 15);
        const replacement = `MEDIA_REPLACEMENT_${hash}`;

        let src: string | undefined;
        if (
          'src' in fiber.stateNode &&
          typeof fiber.stateNode.src === 'string'
        ) {
          src = await fetchToDataUri(fiber.stateNode.src);
        }

        replacements[replacement] = {
          html: content,
          src,
        };

        return replacement;
      }
    }

    const children = fiber.memoizedProps?.children;
    if (children) {
      try {
        const childrenArray = Children.toArray(children as React.ReactNode);
        if (childrenArray.length > 0) {
          const renderedChildren = renderToString(children as React.ReactNode);
          if (renderedChildren) {
            return `>{${renderedChildren}}</`;
          }
        }
      } catch {
        // If we can't render the children, just skip them
      }
    }

    if (specNode.children.length === 0) {
      return `<${displayName}${props} />`;
    }

    const serializedChildren = await Promise.all(
      specNode.children.map((child) => serialize(child)),
    );
    const childrenJsx = serializedChildren.join('\n');

    return `<${displayName}${props}>\n${childrenJsx}\n</${displayName}>`;
  };

  return serialize(processedNode);
};
```

```js
interface SpecNode {
  fiber: Fiber;
  children: SpecNode[];
}

export const createSpecTree = (root: FiberRoot) => {
  const buildSpecNode = (fiber: Fiber): SpecNode => {
    const node: SpecNode = {
      fiber,
      children: [],
    };

    let child = fiber.child;
    while (child) {
      node.children.push(buildSpecNode(child));
      child = child.sibling;
    }

    return node;
  };

  return buildSpecNode(root.current);
};
```

```js
const convertStylesToTailwind = (styleObj: StylesMap) => {
  const styleStr = styleToCss(styleObj);
  const fakeSelector = `body{${styleStr}}`;
  const result = CssToTailwindTranslator(fakeSelector);
  const resultVal = result.data[0]?.resultVal;
  if (result.code !== 'OK' || !resultVal) {
    throw new Error('Failed to convert styles to tailwind');
  }
  return resultVal;
};

const filterNoisyTailwindClasses = (tailwindClasses: string) => {
  const classes = tailwindClasses.split(' ');
  const noisyProperties = [
    '[border-bottom',
    '[border-left',
    '[border-right',
    '[border-top',
    '[column-rule',
    '[outline',
    'cursor-pointer',
    'font-[',
    'h-auto',
    'w-auto',
  ];
  return classes
    .filter((className) => {
      for (const noisyProperty of noisyProperties) {
        if (className.includes(noisyProperty)) {
          return false;
        }
      }
      return true;
    })
    .join(' ');
};
```
