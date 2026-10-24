export const ResettableItems = ({ items }: { items: string[] }) => {
  let visibleItems = items;
  return (
    <button
      type="button"
      onClick={() => {
        visibleItems = [];
      }}
    >
      {visibleItems.length}
    </button>
  );
};
