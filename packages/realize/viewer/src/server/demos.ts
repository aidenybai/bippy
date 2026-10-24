import { demosSchema, type Demos } from "@/model";
import demosJson from "@/generated/demos.json";

export const demos: Demos = demosSchema.parse(demosJson);

export const demoNames = new Set(demos.examples.map((example) => example.name));
