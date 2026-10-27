import { isHostFiber } from "bippy";
import type { Fiber } from "bippy";
import { MAX_ACTION_LABEL_LENGTH } from "../types";
import type { Action, Capture } from "../types";
import { markDispatchersIdle } from "../write-origins";
import { captureMountedComponent } from "./capture";
import { findMountedFiber, getChildren, isRenderedByChild } from "./fibers";
import { settle } from "./settle";

interface MountedAction extends Action {
  element: HTMLElement;
  value: string;
}

interface ActionCandidate extends Pick<MountedAction, "kind" | "value"> {}

interface DomAction {
  kind: Action["kind"];
  isCandidate: (props: Record<string, unknown>, tag: string) => boolean;
  getValues: (element: HTMLElement) => string[];
  hasValue: boolean;
  perform: (element: HTMLElement, value: string) => void;
}

const INPUT_TAGS = new Set(["input", "textarea", "select"]);
const UNTYPEABLE_INPUT_TYPES = new Set(["checkbox", "radio", "file"]);
const FORM_ACTION_TAGS = new Set(["button", "input"]);
const CHANGE_VALUES = ["text", ""];
const KEYS = ["Enter", "Escape"];
const NO_VALUES = [""];
const MAX_SELECT_CHANGE_VALUES = 3;

const getLabel = (element: HTMLElement): string =>
  (
    element.getAttribute("aria-label") ??
    element.getAttribute("name") ??
    element.getAttribute("placeholder") ??
    element.textContent ??
    ""
  )
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_ACTION_LABEL_LENGTH);

const getChangeValues = (element: HTMLElement): string[] =>
  element instanceof HTMLSelectElement
    ? [...new Set([...element.options].map((option) => option.value))].slice(
        0,
        MAX_SELECT_CHANGE_VALUES,
      )
    : CHANGE_VALUES;

const hasHandler = (props: Record<string, unknown>, names: string[]): boolean =>
  names.some((name) => typeof props[name] === "function");

const setInputValue = (element: HTMLElement, value: string): void => {
  const prototype = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const dispatchAll = (element: HTMLElement, events: Event[]): void => {
  for (const event of events) element.dispatchEvent(event);
};

const DOM_ACTIONS: DomAction[] = [
  {
    kind: "click",
    isCandidate: (props, tag) =>
      props.disabled !== true &&
      (hasHandler(props, ["onClick"]) ||
        (FORM_ACTION_TAGS.has(tag) && hasHandler(props, ["formAction"]))),
    getValues: () => NO_VALUES,
    hasValue: false,
    perform: (element) => element.click(),
  },
  {
    kind: "submit",
    isCandidate: (props, tag) => tag === "form" && hasHandler(props, ["onSubmit", "action"]),
    getValues: () => NO_VALUES,
    hasValue: false,
    perform: (element) => {
      if (element instanceof HTMLFormElement) element.requestSubmit();
    },
  },
  {
    kind: "change",
    isCandidate: (props, tag) =>
      INPUT_TAGS.has(tag) &&
      !UNTYPEABLE_INPUT_TYPES.has(String(props.type)) &&
      hasHandler(props, ["onChange", "onInput"]),
    getValues: getChangeValues,
    hasValue: true,
    perform: setInputValue,
  },
  {
    kind: "keydown",
    isCandidate: (props) => hasHandler(props, ["onKeyDown"]),
    getValues: () => KEYS,
    hasValue: true,
    perform: (element, key) =>
      dispatchAll(element, [
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      ]),
  },
  {
    kind: "focus",
    isCandidate: (props) => hasHandler(props, ["onFocus"]),
    getValues: () => NO_VALUES,
    hasValue: false,
    perform: (element) => dispatchAll(element, [new FocusEvent("focusin", { bubbles: true })]),
  },
  {
    kind: "blur",
    isCandidate: (props) => hasHandler(props, ["onBlur"]),
    getValues: () => NO_VALUES,
    hasValue: false,
    perform: (element) => dispatchAll(element, [new FocusEvent("focusout", { bubbles: true })]),
  },
  {
    kind: "hover",
    isCandidate: (props) => hasHandler(props, ["onMouseEnter", "onPointerEnter"]),
    getValues: () => NO_VALUES,
    hasValue: false,
    perform: (element) =>
      dispatchAll(element, [
        new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
        new MouseEvent("mouseover", { bubbles: true }),
      ]),
  },
  {
    kind: "unhover",
    isCandidate: (props) => hasHandler(props, ["onMouseLeave", "onPointerLeave"]),
    getValues: () => NO_VALUES,
    hasValue: false,
    perform: (element) =>
      dispatchAll(element, [
        new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }),
        new MouseEvent("mouseout", { bubbles: true }),
      ]),
  },
];

const DOM_ACTIONS_BY_KIND = new Map(DOM_ACTIONS.map((domAction) => [domAction.kind, domAction]));

const getActionCandidates = (
  props: Record<string, unknown>,
  tag: string,
  element: HTMLElement,
): ActionCandidate[] =>
  DOM_ACTIONS.filter((domAction) => domAction.isCandidate(props, tag)).flatMap((domAction) =>
    domAction.getValues(element).map((value) => ({ kind: domAction.kind, value })),
  );

const getActionBaseKey = (candidate: ActionCandidate, tag: string, label: string): string => {
  const valueSuffix = DOM_ACTIONS_BY_KIND.get(candidate.kind)?.hasValue
    ? `=${candidate.value}`
    : "";
  return `${candidate.kind}:${tag}:${label}${valueSuffix}`;
};

export const collectActions = (): MountedAction[] => {
  const mountedFiber = findMountedFiber();
  const actions: MountedAction[] = [];
  const countsByBaseKey = new Map<string, number>();
  const visit = (fiber: Fiber): void => {
    if (isHostFiber(fiber) && fiber.stateNode instanceof HTMLElement) {
      const props: Record<string, unknown> = fiber.memoizedProps ?? {};
      const tag = String(fiber.type);
      const label = getLabel(fiber.stateNode);
      for (const candidate of getActionCandidates(props, tag, fiber.stateNode)) {
        const baseKey = getActionBaseKey(candidate, tag, label);
        const duplicateCount = countsByBaseKey.get(baseKey) ?? 0;
        countsByBaseKey.set(baseKey, duplicateCount + 1);
        actions.push({
          ...candidate,
          key: duplicateCount === 0 ? baseKey : `${baseKey}#${duplicateCount}`,
          tag,
          label,
          isInChild: isRenderedByChild(fiber),
          element: fiber.stateNode,
        });
      }
    }
    for (const child of getChildren(fiber)) visit(child);
  };
  if (mountedFiber) for (const child of getChildren(mountedFiber)) visit(child);
  return actions;
};

export const performAction = async (key: string): Promise<Capture | null> => {
  const action = collectActions().find((candidate) => candidate.key === key);
  if (!action) return null;
  markDispatchersIdle();
  DOM_ACTIONS_BY_KIND.get(action.kind)?.perform(action.element, action.value);
  await settle();
  return captureMountedComponent();
};
