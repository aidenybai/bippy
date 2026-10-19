import { z } from "zod";

const viewPositionSchema = z.object({ line: z.number(), column: z.number(), index: z.number() });

const viewLocationSchema = z.object({ start: viewPositionSchema, end: viewPositionSchema });

const armSchema = z.enum(["consequent", "alternate"]);

const viewBindingSchema = z.object({
  id: z.number(),
  name: z.string(),
  domain: z.string(),
  initial: z.string().nullable(),
  reachable: z.string().nullable(),
  loc: viewLocationSchema.nullable(),
});

const viewBranchSchema = z.object({
  id: z.number(),
  test: z.string(),
  negated: z.string(),
  loc: viewLocationSchema.nullable(),
  consequent: viewLocationSchema.nullable(),
  alternate: viewLocationSchema.nullable(),
  readsBindingIds: z.array(z.number()),
  never: armSchema.nullable(),
});

const viewUpdateSchema = z.object({
  bindingId: z.number(),
  guard: z.string().nullable(),
  assignments: z.array(z.string()),
  isAsync: z.boolean(),
});

const viewHandlerSchema = z.object({
  id: z.string(),
  label: z.string(),
  loc: viewLocationSchema.nullable(),
  updates: z.array(viewUpdateSchema),
});

const viewTransitionSchema = z.object({
  handlerId: z.string(),
  targets: z.array(z.number()),
  isAsync: z.boolean(),
});

const viewStateSchema = z.object({
  index: z.number(),
  conditions: z.array(z.string()),
  label: z.string(),
  render: z.string(),
  transitions: z.array(viewTransitionSchema),
});

const viewRegionSchema = z.object({
  placeNames: z.array(z.string()),
  states: z.array(z.number()),
});

const graphNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["handler", "trigger", "binding", "write", "read", "branch", "arm"]),
  label: z.string(),
  loc: viewLocationSchema,
  anchor: viewLocationSchema.optional(),
  handlerId: z.string().optional(),
  bindingId: z.number().optional(),
  branchId: z.number().optional(),
  arm: armSchema.optional(),
});

const graphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["triggers", "writes", "reads", "decides", "shows", "hides"]),
});

const codeGraphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

const viewComponentSchema = z.object({
  name: z.string(),
  loc: viewLocationSchema.nullable(),
  bindings: z.array(viewBindingSchema),
  branches: z.array(viewBranchSchema),
  handlers: z.array(viewHandlerSchema),
  states: z.array(viewStateSchema),
  regions: z.array(viewRegionSchema),
  graph: codeGraphSchema,
});

const viewFileSchema = z.object({
  file: z.string(),
  source: z.string(),
  components: z.array(viewComponentSchema),
});

const exampleSchema = z.object({ file: z.string(), name: z.string() });

export const demosSchema = z.object({
  examples: z.array(exampleSchema),
  views: z.record(z.string(), viewFileSchema),
  json: z.record(z.string(), z.string()),
});

export type ViewLocation = z.infer<typeof viewLocationSchema>;
export type ViewBinding = z.infer<typeof viewBindingSchema>;
export type ViewBranch = z.infer<typeof viewBranchSchema>;
export type ViewUpdate = z.infer<typeof viewUpdateSchema>;
export type ViewHandler = z.infer<typeof viewHandlerSchema>;
export type ViewState = z.infer<typeof viewStateSchema>;
export type ViewRegion = z.infer<typeof viewRegionSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type CodeGraph = z.infer<typeof codeGraphSchema>;
export type ViewComponent = z.infer<typeof viewComponentSchema>;
export type ViewFile = z.infer<typeof viewFileSchema>;
export type Example = z.infer<typeof exampleSchema>;
export type Demos = z.infer<typeof demosSchema>;
