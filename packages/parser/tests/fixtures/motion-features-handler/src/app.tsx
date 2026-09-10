import { motion } from "framer-motion";

const items = ["alpha", "beta"];

export const App = () => (
  <main>
    <motion.div
      className="menu"
      variants={{ enter: { opacity: 1 } }}
      initial="exit"
      animate="enter"
    >
      <h1>Animated</h1>
    </motion.div>
    <motion.section layoutId="card" whileInView={{ opacity: 1 }} onTap={() => {}}>
      <p>Layout and gestures</p>
    </motion.section>
    <motion.ul>
      {items.map((item) => (
        <motion.li key={item} drag whileHover={{ scale: 1.1 }}>
          {item}
        </motion.li>
      ))}
    </motion.ul>
  </main>
);
