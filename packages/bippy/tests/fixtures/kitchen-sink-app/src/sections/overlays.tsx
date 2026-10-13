import { autoUpdate, flip, useFloating, useHover, useInteractions } from "@floating-ui/react";
import { useState } from "react";
import toast, { Toaster as HotToaster } from "react-hot-toast";
import ReactModal from "react-modal";
import { toast as toastify, ToastContainer } from "react-toastify";
import { toast as sonnerToast, Toaster as SonnerToaster } from "sonner";
import { Drawer } from "vaul";

import type { LibrarySection } from "../section-registry";

const SonnerSection = () => (
  <div>
    <SonnerToaster />
    <button data-testid="interact-sonner" onClick={() => sonnerToast("sonner toast")}>
      fire sonner
    </button>
  </div>
);

const HotToastSection = () => (
  <div>
    <HotToaster />
    <button data-testid="interact-react-hot-toast" onClick={() => toast("hot toast")}>
      fire hot toast
    </button>
  </div>
);

const ToastifySection = () => (
  <div>
    <ToastContainer autoClose={false} />
    <button data-testid="interact-react-toastify" onClick={() => toastify("toastify toast")}>
      fire toastify
    </button>
  </div>
);

const VaulSection = () => (
  <Drawer.Root>
    <Drawer.Trigger data-testid="interact-vaul">open drawer</Drawer.Trigger>
    <Drawer.Portal>
      <Drawer.Overlay />
      <Drawer.Content>
        <Drawer.Title>vaul drawer</Drawer.Title>
        <div data-testid="vaul-content">drawer content</div>
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root>
);

const ReactModalSection = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button data-testid="interact-react-modal" onClick={() => setIsOpen(true)}>
        open modal
      </button>
      <ReactModal isOpen={isOpen} ariaHideApp={false} onRequestClose={() => setIsOpen(false)}>
        <div data-testid="react-modal-content">modal content</div>
        <button onClick={() => setIsOpen(false)}>close</button>
      </ReactModal>
    </div>
  );
};

const FloatingUiSection = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [flip()],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);
  return (
    <div>
      <button ref={refs.setReference} data-testid="floating-ui-reference" {...getReferenceProps()}>
        hover for tooltip
      </button>
      {isOpen && (
        <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}>
          floating content
        </div>
      )}
    </div>
  );
};

export const overlaySections: LibrarySection[] = [
  { name: "sonner", Component: SonnerSection },
  { name: "react-hot-toast", Component: HotToastSection },
  { name: "react-toastify", Component: ToastifySection },
  { name: "vaul", Component: VaulSection },
  { name: "react-modal", Component: ReactModalSection },
  { name: "floating-ui", Component: FloatingUiSection },
];
