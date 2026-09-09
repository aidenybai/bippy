import { motion } from "framer-motion";

const items = ["alpha", "beta"];

export const App = () => (
  <main>
    <motion.div className="menu" variants={{ enter: { opacity: 1 } }} initial="exit" animate="enter">
      <h1>Animated</h1>
    </motion.div>
    <motion.section layout drag="x" whileHover={{ scale: 1.1 }}>
      <p>Layout and gestures</p>
    </motion.section>
    <motion.ul>
      {items.map((item) => (
        <motion.li key={item} whileTap={{ scale: 0.9 }} exit={{ opacity: 0 }}>
          {item}
        </motion.li>
      ))}
    </motion.ul>
  </main>
);
