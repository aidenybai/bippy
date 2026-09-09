type Invoke = (...parameters: unknown[]) => unknown;

interface CallableInstanceConstructor {
  new (property: string): Invoke;
}

const CallableInstance = function (this: object, property: string) {
  const self = this;
  const constructor = self.constructor as { prototype: Record<string, Invoke> };
  const prototype = constructor.prototype;
  const method = prototype[property];
  const invoke = function (this: unknown, ...parameters: unknown[]) {
    return method.apply(invoke, parameters);
  };
  Object.setPrototypeOf(invoke, prototype);
  return invoke;
} as unknown as CallableInstanceConstructor;

CallableInstance.prototype.constructor = CallableInstance;

class Pipeline extends CallableInstance {
  steps: string[];

  constructor() {
    super("copy");
    this.steps = [];
  }

  copy() {
    const next = new Pipeline();
    next.steps = [...this.steps];
    return next;
  }

  use(step: string) {
    this.steps.push(step);
    return this;
  }

  run() {
    return this.steps.join(" > ");
  }
}

const Adopting = function (this: object) {
  return { adopted: true, label: "from base" };
} as unknown as new () => { adopted: boolean; label: string };

class Adopter extends Adopting {
  label = "from derived";

  describe() {
    return this.label;
  }
}

const Keeping = function (this: { kept: boolean }) {
  this.kept = true;
} as unknown as new () => { kept: boolean };

class Keeper extends Keeping {
  describe() {
    return this.kept ? "kept" : "lost";
  }
}

export default function CallableClassInstances() {
  const pipeline = new Pipeline().use("parse").use("transform");
  const forked = pipeline().use("stringify");
  const adopter = new Adopter();
  const keeper = new Keeper();
  return (
    <ul>
      <li>{pipeline.run()}</li>
      <li>{forked.run()}</li>
      <li>{typeof forked === "function" ? "callable" : "plain"}</li>
      <li>{Object.getPrototypeOf(forked) === Pipeline.prototype ? "inherits" : "detached"}</li>
      <li>{adopter.label}</li>
      <li>{typeof adopter.describe === "undefined" ? "no methods" : "methods"}</li>
      <li>{keeper.describe()}</li>
    </ul>
  );
}
