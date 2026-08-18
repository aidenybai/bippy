import { DndContext, useDraggable } from "@dnd-kit/core";
import { animated, useSpring } from "@react-spring/web";
import { motion } from "motion/react";
import { useState } from "react";
import { DndProvider, useDrag } from "react-dnd";
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
    >
      react-dnd:{String(isDragging)}
    </div>
  );
};

const ReactDndSection = () => (
  <DndProvider backend={HTML5Backend}>
    <ReactDndCard />
  </DndProvider>
);

export const motionDndSections: LibrarySection[] = [
  { name: "motion", Component: MotionSection },
  { name: "react-spring", Component: ReactSpringSection },
  { name: "dnd-kit", Component: DndKitSection },
  { name: "react-dnd", Component: ReactDndSection },
];
