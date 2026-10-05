import { nullable, object, optional, type Schema, string } from "schema-kit";

interface Walk {
  cache: Map<Schema, Schema>;
  visited: number;
}

const SCHEMA = object({ name: optional(nullable(string())) });

const unwrap = (type: Schema, walk: Walk): Schema => {
  const cached = walk.cache.get(type);
  if (cached) return cached;
  walk.visited += 1;
  const def = type._def;
  const inner =
    def.typeName === "Optional" || def.typeName === "Nullable" ? def.innerType : undefined;
  const result = inner ? unwrap(inner, walk) : type;
  walk.cache.set(type, result);
  return result;
};

export const App = () => {
  const field = SCHEMA._def.shape?.name;
  const walk: Walk = { cache: new Map(), visited: 0 };
  const base = field ? unwrap(field, walk) : null;
  return (
    <form data-visited={walk.visited}>
      <label>{base ? base._def.typeName : "none"}</label>
    </form>
  );
};
