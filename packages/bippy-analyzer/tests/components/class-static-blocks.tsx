interface Descriptor {
  id: string;
  label: string;
}

class Descriptors {
  private static readonly byId: Map<string, Descriptor> = new Map();
  static order: string[] = [];

  static {
    Descriptors.register({ id: "openai", label: "OpenAI" });
    if (typeof window !== "undefined") Descriptors.register({ id: "gemini", label: "Gemini" });
  }

  static count = Descriptors.byId.size;

  static {
    this.register({ id: "local", label: "Local" });
  }

  static register(descriptor: Descriptor) {
    this.byId.set(descriptor.id, descriptor);
    this.order.push(descriptor.id);
  }

  static get(id: string): Descriptor {
    const descriptor = this.byId.get(id);
    if (!descriptor) throw new Error(`Unsupported descriptor: ${id}`);
    return descriptor;
  }

  static all(): Descriptor[] {
    return Array.from(this.byId.values());
  }
}

export const isExact = true;

export default function ClassStaticBlocks() {
  const first = Descriptors.get("openai");
  return (
    <dl>
      <dt>{first.label}</dt>
      <dd>{Descriptors.count}</dd>
      <dd>{Descriptors.order.join(",")}</dd>
      {Descriptors.all().map((descriptor) => (
        <dd key={descriptor.id}>{descriptor.label}</dd>
      ))}
    </dl>
  );
}
