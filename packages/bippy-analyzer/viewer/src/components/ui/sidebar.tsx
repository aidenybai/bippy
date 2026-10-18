import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "26rem";
const SIDEBAR_WIDTH_MOBILE = "20rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

interface SidebarStyle extends CSSProperties {
  "--sidebar-width": string;
}

interface SidebarContextValue {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export const useSidebar = (): SidebarContextValue => {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider.");
  return context;
};

const readCookie = (): boolean | null => {
  const match = document.cookie.match(new RegExp(`(?:^|; )${SIDEBAR_COOKIE_NAME}=(true|false)`));
  return match ? match[1] === "true" : null;
};

const writeCookie = (open: boolean): void => {
  document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
};

interface SidebarProviderProps {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export const SidebarProvider = ({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  children,
}: SidebarProviderProps) => {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = useState(false);
  const [openState, setOpenState] = useState(() => readCookie() ?? defaultOpen);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (value: boolean) => {
      if (onOpenChange) onOpenChange(value);
      else setOpenState(value);
      writeCookie(value);
    },
    [onOpenChange],
  );
  const toggleSidebar = useCallback(
    () => (isMobile ? setOpenMobile((current) => !current) : setOpen(!open)),
    [isMobile, open, setOpen],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);
  const value = useMemo<SidebarContextValue>(
    () => ({
      state: open ? "expanded" : "collapsed",
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [open, setOpen, openMobile, isMobile, toggleSidebar],
  );
  return <SidebarContext value={value}>{children}</SidebarContext>;
};

export const SidebarLayout = ({ className, style, ...props }: ComponentProps<"div">) => {
  const layoutStyle: SidebarStyle = { ...style, "--sidebar-width": SIDEBAR_WIDTH };
  return (
    <div
      data-slot="sidebar-wrapper"
      style={layoutStyle}
      className={cn(
        "group/sidebar-wrapper relative flex h-full min-h-0 w-full overflow-hidden",
        className,
      )}
      {...props}
    />
  );
};

interface SidebarProps extends ComponentProps<"div"> {
  side?: "left" | "right";
  title?: string;
}

const MobileSidebar = ({ side, title, children }: SidebarProps) => {
  const { openMobile, setOpenMobile } = useSidebar();
  const style: SidebarStyle = { "--sidebar-width": SIDEBAR_WIDTH_MOBILE };
  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent
        side={side}
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        className="w-(--sidebar-width) p-0"
        style={style}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">Shows the {title}.</SheetDescription>
        <div className="flex h-full w-full flex-col">{children}</div>
      </SheetContent>
    </Sheet>
  );
};

export const Sidebar = ({
  side = "right",
  title = "Sidebar",
  className,
  children,
  ...props
}: SidebarProps) => {
  const { isMobile, state } = useSidebar();
  if (isMobile)
    return (
      <MobileSidebar side={side} title={title}>
        {children}
      </MobileSidebar>
    );
  return (
    <div
      className="group peer hidden text-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? "offcanvas" : ""}
      data-side={side}
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        className="relative h-full w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-out group-data-[collapsible=offcanvas]:w-0"
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "absolute inset-y-0 z-10 hidden h-full w-(--sidebar-width) transition-[left,right] duration-200 ease-out md:flex",
          "data-[side=left]:left-0 data-[side=left]:border-r data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]",
          "data-[side=right]:right-0 data-[side=right]:border-l data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          className,
        )}
        {...props}
      >
        <div data-sidebar="sidebar" data-slot="sidebar-inner" className="flex size-full flex-col">
          {children}
        </div>
      </div>
    </div>
  );
};

export const SidebarTrigger = ({ className, onClick, ...props }: ComponentProps<typeof Button>) => {
  const { toggleSidebar, open } = useSidebar();
  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      aria-label={open ? "Hide sidebar" : "Show sidebar"}
      aria-pressed={open}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelRight />
    </Button>
  );
};

export const SidebarInset = ({ className, ...props }: ComponentProps<"main">) => (
  <main
    data-slot="sidebar-inset"
    className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col bg-background", className)}
    {...props}
  />
);

export const SidebarContent = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="sidebar-content"
    className={cn("flex min-h-0 flex-1 flex-col overflow-auto overscroll-none", className)}
    {...props}
  />
);

export const SidebarHeader = ({ children }: { children: ReactNode }) => (
  <div data-slot="sidebar-header" className="flex h-11 shrink-0 items-center border-b px-4">
    {children}
  </div>
);
