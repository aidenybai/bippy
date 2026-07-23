(() => {
  if (window.__REACT_STORYBOOK_INJECTED__) {
    window.__REACT_STORYBOOK_INJECTED__.toggle();
    return;
  }

  const PANEL_WIDTH = 420;
  const FRAME_HEIGHT = 180;
  const MAX_VISIBLE = 150;
  const MAX_DEPTH = 3;

  // --- fiber utilities ---

  const getFiberRoot = () => {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook?.getFiberRoots) {
      for (const renderer of hook.renderers.values()) {
        const roots = hook.getFiberRoots(renderer);
        if (roots?.size) return Array.from(roots)[0];
      }
    }
    const candidates = [
      document.getElementById("root"),
      document.getElementById("__next"),
      document.getElementById("app"),
      document.querySelector("[data-reactroot]"),
    ];
    for (const rootElement of candidates) {
      if (!rootElement) continue;
      for (const key in rootElement) {
        if (key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$")) {
          let fiber = rootElement[key];
          while (fiber?.return) fiber = fiber.return;
          if (fiber?.stateNode?.current) return fiber.stateNode;
          return { current: fiber };
        }
      }
    }
    for (const element of document.querySelectorAll("*")) {
      for (const key in element) {
        if (key.startsWith("__reactFiber$") || key.startsWith("__reactContainer$")) {
          let fiber = element[key];
          while (fiber?.return) fiber = fiber.return;
          if (fiber?.stateNode?.current) return fiber.stateNode;
          return { current: fiber };
        }
      }
    }
    return null;
  };

  const isCompositeFiber = (fiber) => [0, 1, 11, 14, 15].includes(fiber.tag);
  const isHostFiber = (fiber) => fiber.tag === 5 || fiber.tag === 26 || fiber.tag === 27 || typeof fiber.type === "string";
  const shouldSkipFiber = (fiber) => [6, 7, 18, 22, 23].includes(fiber.tag);

  const getDisplayName = (fiberType) => {
    if (typeof fiberType === "string") return fiberType;
    if (typeof fiberType === "function") return fiberType.displayName || fiberType.name || null;
    if (typeof fiberType === "object" && fiberType) {
      return fiberType.displayName || fiberType.name || getDisplayName(fiberType.type || fiberType.render) || null;
    }
    return null;
  };

  const getNearestHostFibers = (fiber) => {
    const hostFibers = [];
    const stack = [];
    if (isHostFiber(fiber)) {
      hostFibers.push(fiber);
    } else if (fiber.child) {
      stack.push(fiber.child);
    }
    while (stack.length) {
      const current = stack.pop();
      if (!current) break;
      if (isHostFiber(current)) hostFibers.push(current);
      else if (current.child) stack.push(current.child);
      if (current.sibling) stack.push(current.sibling);
    }
    return hostFibers;
  };

  const getDomNodes = (fiber) => {
    return getNearestHostFibers(fiber)
      .map((hostFiber) => hostFiber.stateNode)
      .filter((node) => node instanceof Element);
  };

  const getBoundingRect = (domNodes) => {
    let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
    for (const domNode of domNodes) {
      const rect = domNode.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      minLeft = Math.min(minLeft, rect.left);
      minTop = Math.min(minTop, rect.top);
      maxRight = Math.max(maxRight, rect.right);
      maxBottom = Math.max(maxBottom, rect.bottom);
    }
    if (minLeft === Infinity) return null;
    return { x: minLeft, y: minTop, width: maxRight - minLeft, height: maxBottom - minTop };
  };

  const safeSerialize = (value, depth = 0) => {
    if (depth > MAX_DEPTH) return "[...]";
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") return `"${value.length > 60 ? value.slice(0, 60) + "…" : value}"`;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "function") return `ƒ ${value.name || "anon"}`;
    if (typeof value === "symbol") return value.toString();
    if (value instanceof Element) return `<${value.tagName.toLowerCase()}>`;
    if (Array.isArray(value)) return `[${value.length}]`;
    if (typeof value === "object") {
      if (value.$$typeof) {
        const typeName = typeof value.type === "string" ? value.type : getDisplayName(value.type) || "?";
        return `<${typeName}/>`;
      }
      const keys = Object.keys(value);
      return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
    }
    return String(value);
  };

  const extractHooks = (fiber) => {
    const hooks = [];
    if (fiber.tag !== 0 && fiber.tag !== 15 && fiber.tag !== 11) return hooks;
    let hookState = fiber.memoizedState;
    let hookIndex = 0;
    while (hookState && typeof hookState === "object" && "memoizedState" in hookState) {
      hooks.push({ index: hookIndex, value: safeSerialize(hookState.memoizedState) });
      hookState = hookState.next;
      hookIndex++;
      if (hookIndex > 20) break;
    }
    return hooks;
  };

  const extractProps = (fiber) => {
    const props = {};
    if (!fiber.memoizedProps || typeof fiber.memoizedProps !== "object") return props;
    for (const [key, value] of Object.entries(fiber.memoizedProps)) {
      if (key === "children") continue;
      props[key] = safeSerialize(value);
    }
    return props;
  };

  const extractState = (fiber) => {
    if (fiber.tag !== 1) return null;
    const stateNode = fiber.stateNode;
    if (stateNode?.state && typeof stateNode.state === "object") {
      const serialized = {};
      for (const [key, value] of Object.entries(stateNode.state)) {
        serialized[key] = safeSerialize(value);
      }
      return serialized;
    }
    return null;
  };

  const buildDomTree = (element, depth = 0, maxTreeDepth = 4) => {
    if (!element || depth > maxTreeDepth) return null;
    if (element.nodeType === 3) {
      const text = element.textContent.trim();
      return text ? { type: "#text", text: text.length > 40 ? text.slice(0, 40) + "…" : text } : null;
    }
    if (element.nodeType !== 1) return null;
    const tag = element.tagName.toLowerCase();
    const attrs = {};
    for (const attr of element.attributes) {
      if (attr.name.startsWith("__react") || attr.name.startsWith("data-react")) continue;
      if (attr.value.length > 50) attrs[attr.name] = attr.value.slice(0, 50) + "…";
      else attrs[attr.name] = attr.value;
    }
    const children = [];
    for (const child of element.childNodes) {
      const childNode = buildDomTree(child, depth + 1, maxTreeDepth);
      if (childNode) children.push(childNode);
      if (children.length >= 8) {
        children.push({ type: "#more", count: element.childNodes.length - 8 });
        break;
      }
    }
    return { type: "element", tag, attrs, children };
  };

  const getComponentDepth = (fiber) => {
    let depth = 0;
    let current = fiber.return;
    while (current) {
      if (isCompositeFiber(current) && !shouldSkipFiber(current)) depth++;
      current = current.return;
    }
    return depth;
  };

  const collectPageStyles = () => {
    const styleTexts = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          styleTexts.push(rule.cssText);
        }
      } catch {
        if (sheet.href) {
          styleTexts.push(`@import url("${sheet.href}");`);
        }
      }
    }
    return styleTexts.join("\n");
  };

  let cachedStyles = null;

  const scanComponents = () => {
    const root = getFiberRoot();
    if (!root) return [];
    cachedStyles = collectPageStyles();
    const components = [];
    const visited = new WeakSet();
    const walk = (fiber) => {
      if (!fiber || visited.has(fiber)) return;
      visited.add(fiber);
      if (isCompositeFiber(fiber) && !shouldSkipFiber(fiber)) {
        const displayName = getDisplayName(fiber.type);
        if (displayName) {
          const domNodes = getDomNodes(fiber);
          const rect = domNodes.length ? getBoundingRect(domNodes) : null;
          const hasVisibleRect = rect && rect.width > 0 && rect.height > 0;
          const propsObj = extractProps(fiber);
          const hooks = extractHooks(fiber);
          const classState = extractState(fiber);
          const domTree = domNodes.length ? buildDomTree(domNodes[0]) : null;
          const domHtml = domNodes.length
            ? domNodes.map((node) => node.outerHTML).join("")
            : null;
          components.push({
            displayName,
            props: propsObj,
            hooks,
            state: classState,
            rect,
            depth: getComponentDepth(fiber),
            hasProps: Object.keys(propsObj).length > 0,
            hasHooks: hooks.length > 0,
            hasState: classState !== null,
            hasVisibleRect,
            domTree,
            domHtml,
          });
        }
      }
      walk(fiber.child);
      walk(fiber.sibling);
    };
    walk(root.current?.child || root.current);
    return components;
  };

  // --- styles ---

  const STYLES = `
    .sb-panel{position:fixed;top:0;right:0;z-index:2147483647;width:${PANEL_WIDTH}px;height:100vh;
      background:#fafafa;border-left:1px solid #e4e4e7;font-family:system-ui,-apple-system,sans-serif;
      display:flex;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,.08);transition:transform .2s}
    .sb-panel.sb-hidden{transform:translateX(${PANEL_WIDTH}px)}
    .sb-toggle{position:fixed;top:12px;right:12px;z-index:2147483647;background:#6366f1;color:#fff;
      border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;
      font-family:system-ui;box-shadow:0 2px 8px rgba(99,102,241,.3)}
    .sb-toggle:hover{background:#4f46e5}
    .sb-hdr{padding:10px 12px;border-bottom:1px solid #e4e4e7;background:#fff;flex-shrink:0}
    .sb-hdr-row{display:flex;align-items:center;justify-content:space-between}
    .sb-title{font-size:13px;font-weight:700;color:#18181b;display:flex;align-items:center;gap:6px}
    .sb-cnt{font-size:10px;background:#f4f4f5;color:#71717a;padding:2px 6px;border-radius:99px}
    .sb-search-w{position:relative;margin-top:8px}
    .sb-search-i{position:absolute;left:8px;top:50%;transform:translateY(-50%);color:#a1a1aa;font-size:11px;pointer-events:none}
    .sb-search{width:100%;padding:6px 8px 6px 26px;border:1px solid #e4e4e7;border-radius:6px;
      font-size:12px;background:#fafafa;outline:none;box-sizing:border-box}
    .sb-search:focus{border-color:#a5b4fc;box-shadow:0 0 0 2px rgba(99,102,241,.12)}
    .sb-list{flex:1;overflow-y:auto;padding:8px;scroll-behavior:smooth}
    .sb-card{border:1px solid #e4e4e7;border-radius:8px;background:#fff;margin-bottom:8px;overflow:hidden}
    .sb-card.sb-hl-card{border-color:#818cf8;box-shadow:0 0 0 1px #818cf8}
    .sb-card-hdr{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;
      cursor:pointer;user-select:none}
    .sb-card-hdr:hover{background:#f9fafb}
    .sb-card-name{font-size:12px;font-weight:600;color:#18181b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sb-badges{display:flex;gap:3px;margin-left:6px}
    .sb-bdg{font-size:8px;padding:1px 5px;border-radius:3px;font-weight:600}
    .sb-bdg-p{background:#d1fae5;color:#059669}
    .sb-bdg-h{background:#ede9fe;color:#7c3aed}
    .sb-bdg-s{background:#fef3c7;color:#d97706}
    .sb-bdg-d{background:#dbeafe;color:#2563eb}
    .sb-card-btns{display:flex;gap:3px;flex-shrink:0;margin-left:4px}
    .sb-btn-sm{font-size:9px;padding:2px 7px;border-radius:4px;border:none;cursor:pointer;font-weight:500;
      background:#f4f4f5;color:#52525b}
    .sb-btn-sm:hover{background:#e4e4e7}
    .sb-btn-sm.sb-on{background:#6366f1;color:#fff}
    .sb-frame-wrap{border-top:1px solid #f4f4f5;position:relative;height:${FRAME_HEIGHT}px;overflow:hidden;background:#f8f8fa}
    .sb-frame-iframe{border:none;width:100%;height:100%;pointer-events:none;display:block}
    .sb-frame-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#d4d4d8;font-size:11px}
    .sb-card-body{padding:8px 10px 10px;border-top:1px solid #f4f4f5}
    .sb-sec{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px;color:#6366f1}
    .sb-sec.sh{color:#7c3aed}.sb-sec.ss{color:#d97706}.sb-sec.sd{color:#2563eb}.sb-sec.sg{color:#a1a1aa}
    .sb-kv{display:flex;gap:6px;font-size:11px;line-height:1.5;word-break:break-all}
    .sb-k{color:#3f3f46;font-weight:500;flex-shrink:0}
    .sb-v{color:#6366f1}.sb-v.vs{color:#059669}.sb-v.vn{color:#d97706}.sb-v.vb{color:#7c3aed}.sb-v.vf{color:#2563eb;font-style:italic}
    .sb-dom-tree{font-family:ui-monospace,monospace;font-size:10px;line-height:1.6;color:#52525b;
      max-height:140px;overflow-y:auto;padding:4px 0}
    .sb-dom-tag{color:#2563eb}.sb-dom-attr{color:#7c3aed}.sb-dom-val{color:#059669}
    .sb-dom-txt{color:#a1a1aa;font-style:italic}
    .sb-dom-more{color:#d4d4d8;font-style:italic}
    .sb-chev{display:inline-block;font-size:10px;color:#a1a1aa;margin-right:4px;transition:transform .12s}
    .sb-chev.sb-open{transform:rotate(90deg)}
    .sb-footer{padding:6px 12px;border-top:1px solid #e4e4e7;background:#fff;flex-shrink:0;font-size:10px;color:#a1a1aa}
    .sb-empty{text-align:center;padding:32px 16px;color:#a1a1aa;font-size:12px}
    .sb-trunc{text-align:center;font-size:10px;color:#a1a1aa;padding:8px}
    .sb-hl-box{position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #6366f1;
      background:rgba(99,102,241,.05);border-radius:3px}
    .sb-hl-lbl{position:fixed;pointer-events:none;z-index:2147483646;background:#6366f1;color:#fff;
      font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;font-family:system-ui;
      transform:translateY(-100%);white-space:nowrap}
    .sb-tabs{display:flex;border-top:1px solid #f4f4f5}
    .sb-tab{flex:1;padding:5px 0;text-align:center;font-size:10px;font-weight:600;cursor:pointer;
      color:#a1a1aa;border-bottom:2px solid transparent;background:none;border-top:none;border-left:none;border-right:none}
    .sb-tab:hover{color:#71717a;background:#fafafa}
    .sb-tab.sb-active{color:#6366f1;border-bottom-color:#6366f1}
    .sb-tab-content{display:none}.sb-tab-content.sb-show{display:block}
  `;

  // --- inject styles ---
  const styleEl = document.createElement("style");
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  // --- build panel (stop propagation so host page handlers don't interfere) ---
  const panel = document.createElement("div");
  panel.className = "sb-panel";
  panel.addEventListener("click", (event) => event.stopPropagation());
  panel.addEventListener("mousedown", (event) => event.stopPropagation());
  panel.addEventListener("mouseup", (event) => event.stopPropagation());

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "sb-toggle";
  toggleBtn.textContent = "Storybook";
  document.body.appendChild(toggleBtn);

  let isPanelVisible = true;
  const toggle = () => {
    isPanelVisible = !isPanelVisible;
    panel.classList.toggle("sb-hidden", !isPanelVisible);
    toggleBtn.style.display = isPanelVisible ? "none" : "block";
  };
  toggleBtn.style.display = "none";
  toggleBtn.addEventListener("click", toggle);

  const header = document.createElement("div");
  header.className = "sb-hdr";
  header.innerHTML = `
    <div class="sb-hdr-row">
      <div class="sb-title">Storybook <span class="sb-cnt" id="sb-count">0</span></div>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="sb-btn-sm" id="sb-rescan" title="Rescan">↻</button>
        <button class="sb-btn-sm" id="sb-close" title="Collapse">→</button>
      </div>
    </div>
    <div class="sb-search-w">
      <span class="sb-search-i">⌕</span>
      <input class="sb-search" id="sb-search" placeholder="Filter components…">
    </div>`;

  const listContainer = document.createElement("div");
  listContainer.className = "sb-list";

  const footerEl = document.createElement("div");
  footerEl.className = "sb-footer";
  footerEl.textContent = "Scanning…";

  panel.appendChild(header);
  panel.appendChild(listContainer);
  panel.appendChild(footerEl);
  document.body.appendChild(panel);

  const countEl = () => header.querySelector("#sb-count");
  const searchEl = () => header.querySelector("#sb-search");
  header.querySelector("#sb-rescan")?.addEventListener("click", doScan);
  header.querySelector("#sb-close")?.addEventListener("click", toggle);

  let highlightedIndices = new Set();
  let overlayEls = [];

  const clearOverlays = () => { overlayEls.forEach((el) => el.remove()); overlayEls = []; };

  const renderOverlays = (components) => {
    clearOverlays();
    for (const componentIndex of highlightedIndices) {
      const component = components[componentIndex];
      if (!component?.rect) continue;
      const box = document.createElement("div");
      box.className = "sb-hl-box";
      box.style.cssText = `left:${component.rect.x - 2}px;top:${component.rect.y - 2}px;width:${component.rect.width + 4}px;height:${component.rect.height + 4}px`;
      const lbl = document.createElement("div");
      lbl.className = "sb-hl-lbl";
      lbl.textContent = `<${component.displayName}/>`;
      lbl.style.cssText = `left:${component.rect.x - 2}px;top:${component.rect.y - 4}px`;
      document.body.appendChild(box);
      document.body.appendChild(lbl);
      overlayEls.push(box, lbl);
    }
  };

  // --- dom tree rendering ---

  const renderDomTreeNode = (node, indent = 0) => {
    const pad = "  ".repeat(indent);
    if (node.type === "#text") {
      return `${pad}<span class="sb-dom-txt">${escapeHtml(node.text)}</span>\n`;
    }
    if (node.type === "#more") {
      return `${pad}<span class="sb-dom-more">…${node.count} more</span>\n`;
    }
    const attrStr = Object.entries(node.attrs || {})
      .slice(0, 4)
      .map(([attrKey, attrValue]) => ` <span class="sb-dom-attr">${escapeHtml(attrKey)}</span>=<span class="sb-dom-val">"${escapeHtml(attrValue)}"</span>`)
      .join("");
    const moreAttrs = Object.keys(node.attrs || {}).length > 4 ? " …" : "";
    let result = `${pad}<span class="sb-dom-tag">&lt;${node.tag}</span>${attrStr}${moreAttrs}<span class="sb-dom-tag">&gt;</span>\n`;
    if (node.children?.length) {
      for (const child of node.children) {
        result += renderDomTreeNode(child, indent + 1);
      }
      result += `${pad}<span class="sb-dom-tag">&lt;/${node.tag}&gt;</span>\n`;
    }
    return result;
  };

  const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // --- visual frame ---

  const createFrame = (component) => {
    const frameWrap = document.createElement("div");
    frameWrap.className = "sb-frame-wrap";

    if (!component.domHtml || !component.hasVisibleRect) {
      frameWrap.innerHTML = `<div class="sb-frame-empty">No visible DOM</div>`;
      return frameWrap;
    }

    const componentWidth = component.rect.width;
    const componentHeight = component.rect.height;
    const containerWidth = PANEL_WIDTH - 2;
    const scaleX = containerWidth / componentWidth;
    const scaleY = FRAME_HEIGHT / componentHeight;
    const scale = Math.min(scaleX, scaleY, 1.5);

    const cleanHtml = component.domHtml
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "");

    const iframe = document.createElement("iframe");
    iframe.className = "sb-frame-iframe";
    iframe.loading = "lazy";
    iframe.srcdoc = `<!DOCTYPE html>
<html><head><style>
${cachedStyles || ""}
*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
html,body{margin:0;padding:0;overflow:hidden;background:#f8f8fa;
  width:${containerWidth}px;height:${FRAME_HEIGHT}px}
.sb-fi{transform:scale(${scale});transform-origin:top left;
  width:${componentWidth}px;position:absolute;top:0;left:0}
</style></head><body><div class="sb-fi">${cleanHtml}</div></body></html>`;
    frameWrap.appendChild(iframe);

    return frameWrap;
  };

  // --- card rendering ---

  const getValueClass = (serializedValue) => {
    if (serializedValue.startsWith('"')) return "vs";
    if (serializedValue === "true" || serializedValue === "false") return "vb";
    if (serializedValue.startsWith("ƒ")) return "vf";
    if (!isNaN(Number(serializedValue)) && serializedValue !== "null" && serializedValue !== "undefined") return "vn";
    return "";
  };

  const mkKV = (keyText, valueText) => {
    const kvEl = document.createElement("div");
    kvEl.className = "sb-kv";
    kvEl.innerHTML = `<span class="sb-k">${escapeHtml(keyText)}:</span><span class="sb-v ${getValueClass(valueText)}">${escapeHtml(valueText)}</span>`;
    return kvEl;
  };

  const renderCard = (component, componentIndex, allComponents) => {
    const card = document.createElement("div");
    card.className = "sb-card" + (highlightedIndices.has(componentIndex) ? " sb-hl-card" : "");
    card.style.marginLeft = Math.min(component.depth, 5) * 8 + "px";

    const cardHeader = document.createElement("div");
    cardHeader.className = "sb-card-hdr";

    const nameArea = document.createElement("div");
    nameArea.style.cssText = "display:flex;align-items:center;flex:1;min-width:0";
    const chevron = document.createElement("span");
    chevron.className = "sb-chev";
    chevron.textContent = "▶";
    const nameSpan = document.createElement("span");
    nameSpan.className = "sb-card-name";
    nameSpan.textContent = `<${component.displayName} />`;

    const badges = document.createElement("span");
    badges.className = "sb-badges";
    if (component.hasVisibleRect) badges.innerHTML += `<span class="sb-bdg sb-bdg-d">dom</span>`;
    if (component.hasProps) badges.innerHTML += `<span class="sb-bdg sb-bdg-p">props</span>`;
    if (component.hasHooks) badges.innerHTML += `<span class="sb-bdg sb-bdg-h">hooks</span>`;
    if (component.hasState) badges.innerHTML += `<span class="sb-bdg sb-bdg-s">state</span>`;

    nameArea.appendChild(chevron);
    nameArea.appendChild(nameSpan);
    nameArea.appendChild(badges);

    const btns = document.createElement("div");
    btns.className = "sb-card-btns";
    if (component.rect) {
      const hlBtn = document.createElement("button");
      hlBtn.className = "sb-btn-sm" + (highlightedIndices.has(componentIndex) ? " sb-on" : "");
      hlBtn.textContent = highlightedIndices.has(componentIndex) ? "Hide" : "HL";
      hlBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (highlightedIndices.has(componentIndex)) highlightedIndices.delete(componentIndex);
        else highlightedIndices.add(componentIndex);
        renderOverlays(allComponents);
        hlBtn.className = "sb-btn-sm" + (highlightedIndices.has(componentIndex) ? " sb-on" : "");
        hlBtn.textContent = highlightedIndices.has(componentIndex) ? "Hide" : "HL";
        card.className = "sb-card" + (highlightedIndices.has(componentIndex) ? " sb-hl-card" : "");
      });
      btns.appendChild(hlBtn);
    }

    cardHeader.appendChild(nameArea);
    cardHeader.appendChild(btns);

    let isExpanded = false;
    let detailArea = null;

    cardHeader.addEventListener("click", () => {
      isExpanded = !isExpanded;
      chevron.className = "sb-chev" + (isExpanded ? " sb-open" : "");
      if (isExpanded && !detailArea) {
        detailArea = document.createElement("div");

        detailArea.appendChild(createFrame(component));

        const tabs = document.createElement("div");
        tabs.className = "sb-tabs";
        const tabData = [];
        if (component.domTree) tabData.push({ label: "DOM", id: "dom" });
        if (component.hasProps) tabData.push({ label: "Props", id: "props" });
        if (component.hasHooks) tabData.push({ label: "Hooks", id: "hooks" });
        if (component.hasState) tabData.push({ label: "State", id: "state" });
        if (component.rect) tabData.push({ label: "Bounds", id: "bounds" });

        const tabContents = {};

        tabData.forEach((tabInfo, tabIndex) => {
          const tabButton = document.createElement("button");
          tabButton.className = "sb-tab" + (tabIndex === 0 ? " sb-active" : "");
          tabButton.textContent = tabInfo.label;
          tabs.appendChild(tabButton);

          const tabContent = document.createElement("div");
          tabContent.className = "sb-tab-content sb-card-body" + (tabIndex === 0 ? " sb-show" : "");
          tabContents[tabInfo.id] = tabContent;

          tabButton.addEventListener("click", () => {
            tabs.querySelectorAll(".sb-tab").forEach((tabEl) => tabEl.classList.remove("sb-active"));
            tabButton.classList.add("sb-active");
            Object.values(tabContents).forEach((contentEl) => contentEl.classList.remove("sb-show"));
            tabContent.classList.add("sb-show");
          });
        });

        if (tabContents.dom && component.domTree) {
          const tree = document.createElement("div");
          tree.className = "sb-dom-tree";
          tree.innerHTML = renderDomTreeNode(component.domTree);
          tabContents.dom.appendChild(tree);
        }
        if (tabContents.props) {
          for (const [propKey, propVal] of Object.entries(component.props)) {
            tabContents.props.appendChild(mkKV(propKey, propVal));
          }
        }
        if (tabContents.hooks) {
          for (const hookEntry of component.hooks) {
            tabContents.hooks.appendChild(mkKV(`hook[${hookEntry.index}]`, hookEntry.value));
          }
        }
        if (tabContents.state) {
          for (const [stateKey, stateVal] of Object.entries(component.state)) {
            tabContents.state.appendChild(mkKV(stateKey, stateVal));
          }
        }
        if (tabContents.bounds && component.rect) {
          tabContents.bounds.appendChild(mkKV("size", `${Math.round(component.rect.width)} × ${Math.round(component.rect.height)}`));
          tabContents.bounds.appendChild(mkKV("position", `(${Math.round(component.rect.x)}, ${Math.round(component.rect.y)})`));
        }

        detailArea.appendChild(tabs);
        for (const contentEl of Object.values(tabContents)) {
          detailArea.appendChild(contentEl);
        }
        card.appendChild(detailArea);
      } else if (detailArea) {
        detailArea.style.display = isExpanded ? "" : "none";
      }
    });

    card.appendChild(cardHeader);
    return card;
  };

  // --- render list ---

  let currentComponents = [];

  const renderList = (filterText = "") => {
    const filtered = filterText
      ? currentComponents.filter((component) => component.displayName.toLowerCase().includes(filterText.toLowerCase()))
      : currentComponents;
    listContainer.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sb-empty";
      empty.textContent = currentComponents.length === 0 ? "No React components found." : "No matches.";
      listContainer.appendChild(empty);
    } else {
      const visible = filtered.slice(0, MAX_VISIBLE);
      for (let visibleIndex = 0; visibleIndex < visible.length; visibleIndex++) {
        const originalIndex = currentComponents.indexOf(visible[visibleIndex]);
        listContainer.appendChild(renderCard(visible[visibleIndex], originalIndex, currentComponents));
      }
      if (filtered.length > MAX_VISIBLE) {
        const trunc = document.createElement("div");
        trunc.className = "sb-trunc";
        trunc.textContent = `Showing ${MAX_VISIBLE} of ${filtered.length}. Use search.`;
        listContainer.appendChild(trunc);
      }
    }
    const countBadge = countEl();
    if (countBadge) countBadge.textContent = String(filtered.length);
    footerEl.textContent = `${currentComponents.length} components · ${new Date().toLocaleTimeString()}`;
  };

  function doScan() {
    highlightedIndices = new Set();
    clearOverlays();
    currentComponents = scanComponents();
    renderList(searchEl()?.value || "");
  }

  header.querySelector("#sb-search")?.addEventListener("input", (event) => renderList(event.target.value));

  doScan();

  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook) {
    let rescanTimeout = null;
    let isScanning = false;
    const originalOnCommit = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = function (...args) {
      originalOnCommit?.apply(this, args);
      if (isScanning || rescanTimeout) return;
      rescanTimeout = setTimeout(() => {
        rescanTimeout = null;
        isScanning = true;
        currentComponents = scanComponents();
        renderList(searchEl()?.value || "");
        renderOverlays(currentComponents);
        isScanning = false;
      }, 200);
    };
  }

  window.__REACT_STORYBOOK_INJECTED__ = { toggle, rescan: doScan };
  console.log("%c[Storybook] Injected! Found " + currentComponents.length + " components.", "color:#6366f1;font-weight:bold");
})();
