import * as React from "react";

type Slice = readonly [number, number];

let emptySelection: Selection | undefined;

class Selection {
  private constructor(public readonly items: readonly Slice[]) {}

  static empty = (): Selection => {
    return emptySelection ?? (emptySelection = new Selection([]));
  };

  static fromSingleSelection = (selection: number): Selection => {
    return Selection.empty().add(selection);
  };

  public add(selection: number): Selection {
    return new Selection([...this.items, [selection, selection + 1]]);
  }

  public first(): number | undefined {
    if (this.items.length === 0) return undefined;
    return this.items[0][0];
  }
}

class Shape {
  constructor(
    protected readonly kind: string,
    public label = "shape",
  ) {}
}

class Circle extends Shape {
  constructor(private radius: number) {
    super("circle");
  }

  describe(): string {
    return `${this.kind} r=${this.radius} (${this.label})`;
  }
}

const ParameterProperties = () => {
  const selection = Selection.fromSingleSelection(12);
  const circle = new Circle(3);
  return (
    <ul>
      <li>
        first: {selection.first()} of {selection.items.length}
      </li>
      <li>{circle.describe()} radius {circle["radius"]}</li>
      {Selection.empty().items.length === 0 ? <li>empty is empty</li> : <li>empty has items</li>}
    </ul>
  );
};

export default ParameterProperties;
