import { colors } from "diagram/tokens";
import type { GraphEdge, GraphNode } from "./model";

export type Role =
  | "event"
  | "handler"
  | "sets"
  | "state"
  | "displays"
  | "reads"
  | "condition"
  | "when-true"
  | "when-false"
  | "component"
  | "render";

export const ROLE_COLORS: Record<Role, string> = {
  event: colors.context,
  handler: colors.context,
  sets: colors.update,
  state: colors.text,
  displays: colors.line,
  reads: colors.line,
  condition: colors.suspense,
  "when-true": colors.suspense,
  "when-false": colors.muted,
  component: colors.text,
  render: colors.line,
};

export const getRole = (node: GraphNode): Role => {
  switch (node.kind) {
    case "trigger":
      return "event";
    case "handler":
      return "handler";
    case "write":
      return "sets";
    case "binding":
      return "state";
    case "read":
      return node.handlerId ? "reads" : "displays";
    case "branch":
      return "condition";
    case "arm":
      return node.arm === "consequent" ? "when-true" : "when-false";
    case "component":
      return "component";
    case "render":
      return "render";
  }
};

export const getRoleColor = (node: GraphNode): string => ROLE_COLORS[getRole(node)];

export const getRoleLabel = (node: GraphNode): string => {
  switch (node.kind) {
    case "trigger":
      return `on ${node.label}`;
    case "handler":
      return "";
    case "write":
      return `sets ${node.label.replace(/^writes /, "")}`;
    case "binding":
      return `state ${node.label.split(" · ")[0]}`;
    case "read":
      return node.handlerId ? `reads ${node.label.split(" ")[0]}` : `displays ${node.label.split(" ")[0]}`;
    case "branch":
      return "condition";
    case "arm":
      return node.arm === "consequent" ? "when true" : "when false";
    case "component":
      return `component ${node.label}`;
    case "render":
      return `renders ${node.label}`;
  }
};

export const getEdgeKind = (edge: GraphEdge): "data" | "update" | "context" | "owner" => {
  switch (edge.kind) {
    case "writes":
      return "update";
    case "shows":
    case "hides":
      return "context";
    case "renders":
      return "owner";
    default:
      return "data";
  }
};
