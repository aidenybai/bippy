import { motion as legacyMotion } from "framer-motion";
import { motion } from "motion/react";

export const App = () => (
  <main>
    <legacyMotion.div className="hero" animate={{ opacity: 1 }} initial={{ opacity: 0 }}>
      <h1>Legacy</h1>
    </legacyMotion.div>
    <motion.section whileHover={{ scale: 1.1 }}>
      <p>Current</p>
    </motion.section>
  </main>
);
