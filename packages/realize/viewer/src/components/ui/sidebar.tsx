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

const SIDEBAR_WIDTH = "26rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

interface SidebarStyle extends CSSProperties {
  "--sidebar-width": string;
}

interface SidebarContextValue {
  state: "expanded" | "collapsed";
  isAnimated: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const useSidebar = (): SidebarContextValue => {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider.");
  return context;
};

interface SidebarProviderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export const SidebarProvider = ({ open, onOpenChange, children }: SidebarProviderProps) => {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = useState(false);
  const [isAnimated, setAnimated] = useState(false);
  const setOpen = onOpenChange;
  const toggleSidebar = useCallback(() => {
    setAnimated(true);
    if (isMobile) setOpenMobile((current) => !current);
    else setOpen(!open);
  }, [isMobile, open, setOpen]);
  useEffect(() => {
    if (!isAnimated) return;
    const timer = window.setTimeout(() => setAnimated(false), 250);
    return () => window.clearTimeout(timer);
  }, [isAnimated]);
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
      isAnimated,
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [open, isAnimated, setOpen, openMobile, isMobile, toggleSidebar],
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
  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent
        side={side}
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        className="p-0"
      >
        <div className="flex h-11 shrink-0 items-center border-b px-4">
          <SheetTitle>{title}</SheetTitle>
        </div>
        <SheetDescription className="sr-only">Shows the {title}.</SheetDescription>
        <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
      </SheetContent>
    </Sheet>
  );
};

const DesktopSidebar = ({ side, className, children, ...props }: SidebarProps) => {
  const { state, isAnimated } = useSidebar();
  return (
    <div
      className="group peer hidden text-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? "offcanvas" : ""}
      data-animated={isAnimated || undefined}
      data-side={side}
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        className="relative h-full w-(--sidebar-width) bg-transparent transition-[width] duration-0 ease-out group-data-animated:duration-200 group-data-[collapsible=offcanvas]:w-0"
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "absolute inset-y-0 z-10 hidden h-full w-(--sidebar-width) transition-[left,right] duration-0 ease-out group-data-animated:duration-200 md:flex",
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

export const Sidebar = ({ side = "right", title = "Sidebar", ...props }: SidebarProps) => {
  const { isMobile } = useSidebar();
  if (isMobile) return <MobileSidebar side={side} title={title} {...props} />;
  return <DesktopSidebar side={side} title={title} {...props} />;
};

export const SidebarTrigger = ({ className, onClick, ...props }: ComponentProps<typeof Button>) => {
  const { toggleSidebar, open, openMobile, isMobile } = useSidebar();
  const isOpen = isMobile ? openMobile : open;
  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      aria-label={isOpen ? "Hide sidebar" : "Show sidebar"}
      aria-pressed={isOpen}
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
    className={cn(
      "flex min-h-0 flex-1 flex-col overflow-auto overscroll-none [scrollbar-gutter:stable]",
      className,
    )}
    {...props}
  />
);
