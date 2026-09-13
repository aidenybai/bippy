import type { StaticObjectEntry, StaticObjectValue, StaticValue } from "../types.js";

/**
 * Props a server component hands to a client component cross the Flight
 * boundary as server-created data: an element nested in them that was created
 * at module scope was created by the server module instance, so its function
 * type renders on the server. See `renderElement` in ReactFlightServer.
 */
export class ServerEnvironmentStamper {
  private readonly stamped = new WeakMap<object, StaticValue>();

  stampProps(props: StaticObjectValue): StaticObjectValue {
    const entries = this.stampEntries(props.entries);
    return entries === props.entries ? props : { ...props, entries };
  }

  private stampEntries(entries: StaticObjectEntry[]): StaticObjectEntry[] {
    const stamped = entries.map((entry) => {
      const value = this.stamp(entry.value);
      return value === entry.value ? entry : { ...entry, value };
    });
    return stamped.every((entry, index) => entry === entries[index]) ? entries : stamped;
  }

  private stampAll(values: StaticValue[]): StaticValue[] {
    const stamped = values.map((value) => this.stamp(value));
    return stamped.every((value, index) => value === values[index]) ? values : stamped;
  }

  private stamp(value: StaticValue): StaticValue {
    const previous = this.stamped.get(value);
    if (previous) return previous;
    this.stamped.set(value, value);
    const result = this.stampFresh(value);
    this.stamped.set(value, result);
    return result;
  }

  private stampFresh(value: StaticValue): StaticValue {
    switch (value.kind) {
      case "element": {
        const props = this.stampProps(value.props);
        if (value.environment !== null) {
          return props === value.props ? value : { ...value, props };
        }
        return { ...value, props, environment: "server" };
      }
      case "object":
        return this.stampProps(value);
      case "list": {
        const items = this.stampAll(value.items);
        return items === value.items ? value : { ...value, items };
      }
      case "branch": {
        const alternatives = this.stampAll(value.alternatives);
        return alternatives === value.alternatives ? value : { ...value, alternatives };
      }
      case "optional": {
        const inner = this.stamp(value.value);
        return inner === value.value ? value : { ...value, value: inner };
      }
      case "repeat": {
        const item = this.stamp(value.item);
        return item === value.item ? value : { ...value, item };
      }
      default:
        return value;
    }
  }
}
