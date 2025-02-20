import { nanoid } from 'nanoid';

const fetchToDataUri = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to fetch media:', error);
    return url; // Fallback to original URL if fetch fails
  }
};

interface MediaReplacement {
  type: 'media';
  src: string;
  html: string;
}

interface SVGReplacement {
  type: 'svg';
  html: string;
}

type Replacement = MediaReplacement | SVGReplacement;

export const getReplacements = async (
  element: Element,
): Promise<Map<string, Replacement>> => {
  const clonedElement = element.cloneNode(true);
  const replacementsMap = new Map<string, Replacement>();
  const walker = document.createTreeWalker(
    clonedElement,
    NodeFilter.SHOW_ELEMENT,
  );
  let current = walker.firstChild();

  const toReplaceSrc: {
    src: string;
    replacement: MediaReplacement;
  }[] = [];

  while (current) {
    const alt = 'alt' in current ? current.alt : '';
    const placeholder = `<placeholder id="${nanoid()}" ${alt ? `alt="${alt}"` : ''} />`;
    if (
      current instanceof HTMLImageElement ||
      current instanceof HTMLVideoElement ||
      current instanceof HTMLAudioElement
    ) {
      const replacement = {
        type: 'media',
        src: current.src,
        html: current.outerHTML,
      } as const;
      replacementsMap.set(placeholder, replacement);
      toReplaceSrc.push({
        src: current.src,
        replacement,
      });
      current.outerHTML = placeholder;
      walker.nextSibling();
      continue;
    }

    if (current instanceof SVGElement) {
      replacementsMap.set(placeholder, {
        type: 'svg',
        html: current.outerHTML,
      });
      current.outerHTML = placeholder;
      walker.nextSibling();
      continue;
    }
    current = walker.nextNode();
  }

  await Promise.all(
    toReplaceSrc.map(async ({ src, replacement }) => {
      const dataUri = await fetchToDataUri(src);
      replacement.src = dataUri;
      replacement.html = replacement.html.replace(src, dataUri);
    }),
  );
  return replacementsMap;
};
