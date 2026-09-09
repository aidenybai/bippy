import { motion } from "framer-motion";

export const App = () => (
  <main>
    <motion.div className="hero" animate={{ opacity: 1 }} initial={{ opacity: 0 }}>
      <h1>Animated</h1>
    </motion.div>
    <motion.section whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
      <p>Gestures</p>
    </motion.section>
    <motion.footer>
      <p>Plain</p>
    </motion.footer>
  </main>
);
