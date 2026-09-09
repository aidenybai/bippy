import type { ComponentType } from "react";

const widgets: Record<string, ComponentType<{ title: string }>> = {};

export const registerWidget = (name: string, Widget: ComponentType<{ title: string }>) => {
  widgets[name] = Widget;
};

export const getWidget = (name: string) => widgets[name];
