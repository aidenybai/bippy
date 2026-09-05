import { extractHOCNames } from "./display-name.js";
import type { ComponentBranchEntry, ToolError, Tools } from "./types.js";

export interface OwnersListOptions {
  isVisible?: (owner: ComponentBranchEntry) => boolean;
}

export const getOwnersList = (
  tools: Tools,
  uid: string,
  options: OwnersListOptions = {},
): ComponentBranchEntry[] | ToolError => {
  const component = tools.getComponentByUid(uid);
  if ("error" in component) return component;
  const owners = tools.getOwnerStack(uid);
  if ("error" in owners) return owners;
  const list = [...owners].reverse().map((owner) => ({
    ...owner,
    name: extractHOCNames(owner.name).baseComponentName,
  }));
  list.push({
    name: extractHOCNames(component.name).baseComponentName,
    type: component.type,
    uid: component.uid,
  });
  return options.isVisible ? list.filter(options.isVisible) : list;
};
