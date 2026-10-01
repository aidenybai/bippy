interface PropertyShapeObservation {
  name: string;
  source: string;
}

export const propertyShapeObservations: PropertyShapeObservation[] = [
  {
    name: "value",
    source:
      "const selected = inputFirst ? result.left : result.right; return selected === value ? 'match' : 'missing';",
  },
  {
    name: "presence",
    source:
      "if (inputFirst) return Object.hasOwn(result, 'left') ? 'match' : 'missing'; return Object.hasOwn(result, 'right') ? 'match' : 'missing';",
  },
  {
    name: "absence",
    source:
      "if (inputFirst) return Object.hasOwn(result, 'right') ? 'extra' : 'match'; return Object.hasOwn(result, 'left') ? 'extra' : 'match';",
  },
];
