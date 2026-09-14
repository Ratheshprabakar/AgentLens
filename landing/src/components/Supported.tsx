import { motion, useReducedMotion } from "framer-motion";
import { fadeUp, stagger, viewportOnce, easeOut } from "../lib/motion";
import "./Supported.css";

/**
 * Single place to update when a new agent lands.
 * Logos from https://github.com/glincker/thesvg (jsDelivr CDN).
 */
const SUPPORTED = [
  {
    name: "Claude Code",
    detail: "Live capture",
    status: "live" as const,
    logo: "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/claude-code/default.svg",
  },
  {
    name: "Cursor",
    detail: "Import sessions",
    status: "import" as const,
    logo: "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/cursor/default.svg",
  },
];

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
            Supported Agents
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
              <img
                className="supported__logo"
                src={tool.logo}
                alt=""
                width={40}
                height={40}
              />
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
