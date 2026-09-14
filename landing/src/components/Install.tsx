import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { fadeUp, stagger, viewportOnce } from "../lib/motion";
import "./Install.css";

const DOCKER_INSTALL =
  "curl -sSL https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/main/scripts/install.sh | bash";
const DOCKER_PULL = "docker pull ratheshprabakar/agentlens:v1.0.0";

function CopyBlock({
  label,
  code,
  featured,
}: {
  label: string;
  code: string;
  featured?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const reduce = useReducedMotion();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <motion.div
      className={`install-block ${featured ? "install-block--featured" : ""}`}
      variants={fadeUp}
      whileHover={reduce ? undefined : { borderColor: "var(--line-strong)" }}
    >
      <div className="install-block__head">
        <span className="install-block__label">{label}</span>
        <motion.button
          type="button"
          className="install-block__copy mono"
          onClick={() => void copy()}
          whileTap={reduce ? undefined : { scale: 0.96 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={copied ? "y" : "n"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              {copied ? "copied" : "copy"}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
      <pre className="install-block__code mono">
        <code>{code}</code>
      </pre>
    </motion.div>
  );
}

export default function Install() {
  return (
    <section className="install" id="install">
      <div className="wrap">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.h2 className="install__heading" variants={fadeUp}>
            Install with Docker
          </motion.h2>
          <motion.p className="install__sub" variants={fadeUp}>
            One command starts Postgres, the dashboard, and Claude Code hooks. Or pull the image
            from Docker Hub.
          </motion.p>

          <CopyBlock label="One-line install" code={DOCKER_INSTALL} featured />
          <CopyBlock label="Pull image" code={DOCKER_PULL} />
        </motion.div>
      </div>
    </section>
  );
}
