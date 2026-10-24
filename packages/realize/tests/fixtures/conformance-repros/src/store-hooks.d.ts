declare module "store-hooks" {
  export function useDispatch(): (action: { type: string }) => void;
  export function useSelector<Selected>(
    selector: (state: { isOpen: boolean }) => Selected,
  ): Selected;
}
