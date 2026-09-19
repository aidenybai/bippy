interface PropertyDefinitionMethod {
  name: string;
  statement: string;
}

export const propertyDefinitionMethods: PropertyDefinitionMethod[] = [
  { name: "single", statement: "Object.defineProperty(target, 'entry', descriptor);" },
  { name: "bulk", statement: "Object.defineProperties(target, { entry: descriptor });" },
  { name: "create", statement: "target = Object.create(null, { entry: descriptor });" },
];
