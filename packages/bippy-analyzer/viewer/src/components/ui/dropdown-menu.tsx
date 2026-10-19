import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = (props: MenuPrimitive.Root.Props) => (
  <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
);

export const DropdownMenuTrigger = (props: MenuPrimitive.Trigger.Props) => (
  <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
);

type DropdownMenuContentProps = MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">;

export const DropdownMenuContent = ({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: DropdownMenuContentProps) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      className="isolate z-50 outline-none"
    >
      <MenuPrimitive.Popup
        data-slot="dropdown-menu-content"
        className={cn(
          "z-50 grid max-h-(--available-height) min-w-40 origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-card outline-none transition-[opacity,scale] duration-150 ease-out-soft data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Positioner>
  </MenuPrimitive.Portal>
);

export const DropdownMenuLinkItem = ({ className, ...props }: MenuPrimitive.LinkItem.Props) => (
  <MenuPrimitive.LinkItem
    data-slot="dropdown-menu-link-item"
    className={cn(
      "flex cursor-default items-center gap-2 rounded-md px-2 py-1 outline-none select-none data-highlighted:bg-muted [&_svg]:size-3.5 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
);
