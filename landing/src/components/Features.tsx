import { motion, useReducedMotion } from "framer-motion";
import { fadeUp, stagger, viewportOnce, easeOut } from "../lib/motion";
import "./Features.css";

const FEATURES = [
  {
    title: "Claude Code and Cursor",
    body: "Live capture via Claude Code hooks, plus import for Cursor transcripts - both agents in one timeline.",
    tone: "ok" as const,
  },
  {
    title: "Full session timeline",
    body: "Prompts, reads, edits, shell, and searches in order - so you can see where time went and where the agent got stuck.",
    tone: "edit" as const,
  },
  {
    title: "Local by default",
    body: "Runs on your machine with Postgres. No cloud account. Your sessions never leave the box.",
    tone: "cursor" as const,
  },
  {
    title: "Import what you already have",
    body: "Point AgentLens at existing Claude Code and Cursor transcripts and rebuild history without replaying sessions.",
    tone: "read" as const,
  },
];

export default function Features() {
  const reduce = useReducedMotion();

  return (
    <section className="features" id="features">
      <div className="wrap">
        <motion.div
          className="features__intro"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.h2 className="features__heading" variants={fadeUp}>
            Built to watch agents work
          </motion.h2>
          <motion.p className="features__sub" variants={fadeUp}>
            Turn opaque Claude Code and Cursor sessions into an observatory you
            can scan.
          </motion.p>
        </motion.div>

        <motion.ul
          className="features__list"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          {FEATURES.map((f, i) => (
            <motion.li
              key={f.title}
              className={`features__item features__item--${f.tone}`}
              variants={fadeUp}
              whileHover={reduce ? undefined : { x: 4 }}
              transition={{ duration: 0.2, ease: easeOut }}
            >
              <span className="features__index mono">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="features__content">
                <h3 className="features__title">{f.title}</h3>
                <p className="features__body">{f.body}</p>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
