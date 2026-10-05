import { useId } from "react";

const fragment = new DocumentFragment();
fragment.append(new Text("alpha"), new Comment("hidden"), document.createElement("b"));

const picture = new Image(64, 32);
picture.alt = "logo";

const registry: Record<string, string> = { "user-1": "ada", "user-2": "grace", total: "2" };

export default function HostNodeConstructors() {
  const id = useId();
  const missingLookup = registry[`missing-${id}`];
  const facts: [string, string | number][] = [
    ["children", fragment.childNodes.length],
    ["elements", fragment.children.length],
    ["text", fragment.textContent ?? ""],
    ["width", picture.width],
    ["tag", picture.tagName],
    ["alt", picture.alt],
    ["is-fragment", String(fragment instanceof DocumentFragment)],
    ["is-image", String(picture instanceof HTMLImageElement)],
    ["missing", missingLookup === undefined ? "none" : "found"],
  ];
  return (
    <ul>
      {facts.map(([label, value]) => (
        <li key={label}>
          {label}: {String(value)}
        </li>
      ))}
    </ul>
  );
}

export const isExact = true;
