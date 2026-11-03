import type { ViewBinding, ViewFile } from "@/model";

export const getSourceLine = (view: ViewFile, line: number): string =>
  view.source.split("\n")[line - 1]?.trim() ?? "";

export const shortenType = (value: string): string => value.replace(/<[\s\S]*>$/, "<…>");

export const getDomainValues = (binding: ViewBinding): string[] =>
  binding.domain.split(" | ").map((value) => value.trim());
