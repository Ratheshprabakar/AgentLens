import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { fadeUp, stagger, viewportOnce } from "../lib/motion";
import { installCommand } from "../lib/site";
import "./Install.css";

const CURL_INSTALL = installCommand();

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
            Install in one minute
          </motion.h2>
          <motion.p className="install__sub" variants={fadeUp}>
            One command. It pulls the image, starts everything, wires up live
            capture, and opens the dashboard. You never have to type volume
            mounts.
          </motion.p>

          <CopyBlock label="Install" code={CURL_INSTALL} featured />
        </motion.div>
      </div>
    </section>
  );
}
