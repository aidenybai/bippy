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

const INPUT_TAGS = new Set(["input", "textarea", "select"]);
const FORM_ACTION_TAGS = new Set(["button", "input"]);
const CHANGE_VALUES = ["text", ""];
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

const isClickable = (props: Record<string, unknown>, tag: string): boolean =>
  props.disabled !== true &&
  (typeof props.onClick === "function" ||
    (FORM_ACTION_TAGS.has(tag) && typeof props.formAction === "function"));

const isSubmittable = (props: Record<string, unknown>, tag: string): boolean =>
  tag === "form" && (typeof props.onSubmit === "function" || typeof props.action === "function");

const getActionCandidates = (
  props: Record<string, unknown>,
  tag: string,
  element: HTMLElement,
): ActionCandidate[] => {
  const candidates: ActionCandidate[] = [];
  if (isClickable(props, tag)) candidates.push({ kind: "click", value: "" });
  if (isSubmittable(props, tag)) candidates.push({ kind: "submit", value: "" });
  const isEditable =
    INPUT_TAGS.has(tag) &&
    props.type !== "file" &&
    (typeof props.onChange === "function" || typeof props.onInput === "function");
  if (isEditable)
    for (const value of getChangeValues(element)) candidates.push({ kind: "change", value });
  return candidates;
};

const getActionBaseKey = (candidate: ActionCandidate, tag: string, label: string): string => {
  const valueSuffix = candidate.kind === "change" ? `=${candidate.value}` : "";
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

const setInputValue = (element: HTMLElement, value: string): void => {
  const prototype = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const submitForm = (element: HTMLElement): void => {
  if (element instanceof HTMLFormElement) element.requestSubmit();
};

export const performAction = async (key: string): Promise<Capture | null> => {
  const action = collectActions().find((candidate) => candidate.key === key);
  if (!action) return null;
  markDispatchersIdle();
  if (action.kind === "click") action.element.click();
  else if (action.kind === "submit") submitForm(action.element);
  else setInputValue(action.element, action.value);
  await settle();
  return captureMountedComponent();
};
