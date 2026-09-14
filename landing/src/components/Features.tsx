import { motion, useReducedMotion } from "framer-motion";
import { fadeUp, stagger, viewportOnce, easeOut } from "../lib/motion";
import "./Features.css";

const FEATURES = [
  {
    title: "Watch the next agent run live",
    body: "Every prompt, file read, edit, shell command, and search shows up on one timeline as it happens.",
    tone: "ok" as const,
  },
  {
    title: "Find the loop, not the blame",
    body: "Scan for thrash, dead ends, and the exact step that burned the time - instead of guessing from a wall of logs.",
    tone: "edit" as const,
  },
  {
    title: "Import history you already have",
    body: "Bring in past agent sessions and rebuild the timeline - no need to run them again.",
    tone: "read" as const,
  },
  {
    title: "Local. No account. No upload.",
    body: "Data on your box. Your agent sessions never leave the machine.",
    tone: "cursor" as const,
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
            Built for the &ldquo;what the hell was it doing?&rdquo; moment
          </motion.h2>
          <motion.p className="features__sub" variants={fadeUp}>
            Opaque agent sessions become a scannable timeline - live or
            imported.
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
