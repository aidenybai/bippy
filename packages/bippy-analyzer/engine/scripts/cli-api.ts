import { Agent as EngineAgent, type AgentHostDefined } from "#self";

export * from "#self";

export class Agent extends EngineAgent {
  constructor(options: AgentHostDefined = {}) {
    super({ elideUnusedArguments: true, ...options });
  }
}
