import { motion, useReducedMotion } from "framer-motion";
import { fadeUp, stagger, viewportOnce, easeOut } from "../lib/motion";
import "./Supported.css";

/**
 * Single place to update when a new agent lands.
 * Add an entry here - no need to rewrite the rest of the landing page.
 */
const SUPPORTED = [
  {
    name: "Claude Code",
    detail: "Live capture",
    status: "live" as const,
    mark: "claude" as const,
  },
  {
    name: "Cursor",
    detail: "Import sessions",
    status: "import" as const,
    mark: "cursor" as const,
  },
];

function Mark({ kind }: { kind: "claude" | "cursor" }) {
  if (kind === "claude") {
    return (
      <svg className="supported__mark" viewBox="0 0 40 40" aria-hidden>
        <circle
          cx="20"
          cy="20"
          r="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M20 8.5 L23.2 16.2 L31.5 17.1 L25.2 22.6 L27.1 30.8 L20 26.4 L12.9 30.8 L14.8 22.6 L8.5 17.1 L16.8 16.2 Z"
          fill="currentColor"
          opacity="0.9"
        />
      </svg>
    );
  }
  return (
    <svg className="supported__mark" viewBox="0 0 40 40" aria-hidden>
      <rect
        x="5"
        y="5"
        width="30"
        height="30"
        rx="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M14 12 L28 20 L18 22 L16 28 Z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}

export default function Supported() {
  const reduce = useReducedMotion();

  return (
    <section className="supported" id="supported">
      <div className="wrap">
        <motion.div
          className="supported__intro"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.h2 className="supported__heading" variants={fadeUp}>
            Supported today
          </motion.h2>
          <motion.p className="supported__sub" variants={fadeUp}>
            One timeline for the AI coding agents you already use. More coming.
          </motion.p>
        </motion.div>

        <motion.div
          className="supported__grid"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          {SUPPORTED.map((tool) => (
            <motion.div
              key={tool.name}
              className={`supported__tile supported__tile--${tool.status}`}
              variants={fadeUp}
              whileHover={reduce ? undefined : { y: -3 }}
              transition={{ duration: 0.2, ease: easeOut }}
            >
              <Mark kind={tool.mark} />
              <div className="supported__meta">
                <span className="supported__name">{tool.name}</span>
                <span className="supported__detail mono">{tool.detail}</span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
