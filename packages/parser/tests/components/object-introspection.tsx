class Route {
  path = "/";
}

class ChildRoute extends Route {}

const plain = { path: "/plain" };
const bare: Record<string, string> = Object.create(null);
bare.path = "/bare";
const literalArray = ["/a"];
const routeInstance = new ChildRoute();

const describeConstructor = (value: object): string => {
  const constructor = value.constructor;
  if (constructor === Object) return "Object";
  if (constructor === Array) return "Array";
  if (constructor === undefined) return "none";
  return constructor === ChildRoute ? "ChildRoute" : "other";
};

const facts = [
  `constructor:${[plain, bare, literalArray, routeInstance].map(describeConstructor).join(",")}`,
  `hasOwn:${plain.hasOwnProperty("path")},${plain.hasOwnProperty("toString")},${routeInstance.hasOwnProperty("path")}`,
  `enumerable:${plain.propertyIsEnumerable("path")},${literalArray.propertyIsEnumerable("length")},${literalArray.propertyIsEnumerable(0)}`,
  `isPrototypeOf:${Object.prototype.isPrototypeOf(plain)},${Object.prototype.isPrototypeOf(bare)},${Array.prototype.isPrototypeOf(literalArray)},${Route.prototype.isPrototypeOf(routeInstance)},${ChildRoute.prototype.isPrototypeOf(new Route())}`,
  `protoOwn:${Object.prototype.hasOwnProperty("hasOwnProperty")},${Object.prototype.hasOwnProperty("path")},${Object.prototype.propertyIsEnumerable("toString")}`,
  `plainness:${[plain, bare, routeInstance].map((value) => (value.constructor === Object || value.constructor === undefined ? "plain" : "class")).join(",")}`,
];

export const isExact = true;

export default function ObjectIntrospection() {
  return (
    <ul>
      {facts.map((fact) => (
        <li key={fact}>
          {fact.split(":")[0]}: {fact}
        </li>
      ))}
    </ul>
  );
}
