type Brand<Name extends string> = { readonly __brand: Name };

type OwnerId = string & Brand<"OwnerId">;

type ShapesById = Map<string, { label: string }> & Brand<"ShapesById">;

export const ShapeSummary = ({ ownerId, shapes }: { ownerId: OwnerId; shapes: ShapesById }) => (
  <p>
    {ownerId.toUpperCase()} owns {[...shapes.values()].length} shapes
  </p>
);
