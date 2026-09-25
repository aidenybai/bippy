import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface CorpusProject {
  id: string;
  repository: string;
  revision: string;
  toolchain: string;
}

export const image = "node@sha256:ec82d089a8ae2cf02628da7b34ea57dc357b24db724d557fe2d240e6beb659c1";
export const getCorpusRoot = () => {
  if (!process.argv[2]) throw new Error("Pass an absolute corpus directory as the first argument");
  return resolve(process.argv[2]);
};
export const getProjects = (root: string): CorpusProject[] =>
  JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
