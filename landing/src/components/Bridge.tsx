import { motion } from "framer-motion";
import { fadeUp, stagger, viewportOnce } from "../lib/motion";
import "./Bridge.css";

export default function Bridge() {
  return (
    <section className="bridge" id="why" aria-labelledby="bridge-heading">
      <div className="wrap">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.h2 id="bridge-heading" className="bridge__heading" variants={fadeUp}>
            You already have the logs. You&apos;re reading them wrong.
          </motion.h2>
          <motion.p className="bridge__sub" variants={fadeUp}>
            Agent logs are a firehose. AgentLens turns them into a session you can
            scrub like a replay.
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
