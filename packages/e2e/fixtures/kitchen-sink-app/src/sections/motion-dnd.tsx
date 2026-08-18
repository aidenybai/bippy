import { DndContext, useDraggable } from "@dnd-kit/core";
import { animated, useSpring } from "@react-spring/web";
import { motion } from "motion/react";
import { useState } from "react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import type { LibrarySection } from "../section-registry";

const MotionSection = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <motion.button
      data-testid="interact-motion"
      animate={{ scale: isExpanded ? 1.2 : 1 }}
      onClick={() => setIsExpanded((previous) => !previous)}
    >
      motion:{String(isExpanded)}
    </motion.button>
  );
};

const ReactSpringSection = () => {
  const springStyles = useSpring({ from: { opacity: 0 }, to: { opacity: 1 } });
  return (
    <animated.div data-testid="react-spring-target" style={springStyles}>
      spring content
    </animated.div>
  );
};

const DndKitDraggable = () => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: "dnd-kit-item" });
  return (
    <button
      ref={setNodeRef}
      data-testid="dnd-kit-draggable"
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      {...listeners}
      {...attributes}
    >
      drag me
    </button>
  );
};

const DndKitSection = () => (
  <DndContext>
    <DndKitDraggable />
  </DndContext>
);

const ReactDndCard = () => {
  const [{ isDragging }, dragRef] = useDrag(() => ({
    type: "card",
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  }));
  return (
    <div
      ref={(node) => {
        dragRef(node);
      }}
      data-testid="react-dnd-card"
      draggable
    >
      react-dnd:{String(isDragging)}
    </div>
  );
};

const ReactDndDropZone = () => {
  const [{ isOver }, dropRef, dropCount] = useDropCounter();
  return (
    <div
      ref={(node) => {
        dropRef(node);
      }}
      data-testid="react-dnd-drop-zone"
      style={{ minHeight: 40, border: "1px dashed gray" }}
    >
      drop zone over:{String(isOver)} drops:{dropCount}
    </div>
  );
};

const useDropCounter = () => {
  const [dropCount, setDropCount] = useState(0);
  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: "card",
    drop: () => setDropCount((previous) => previous + 1),
    collect: (monitor) => ({ isOver: monitor.isOver() }),
  }));
  return [{ isOver }, dropRef, dropCount] as const;
};

const ReactDndSection = () => (
  <DndProvider backend={HTML5Backend}>
    <ReactDndCard />
    <ReactDndDropZone />
  </DndProvider>
);

export const motionDndSections: LibrarySection[] = [
  { name: "motion", Component: MotionSection },
  { name: "react-spring", Component: ReactSpringSection },
  { name: "dnd-kit", Component: DndKitSection },
  { name: "react-dnd", Component: ReactDndSection },
];
