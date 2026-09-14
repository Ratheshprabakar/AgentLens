import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { easeOut, stagger, fadeUp } from "../lib/motion";
import { installCommand } from "../lib/site";
import "./Hero.css";

const GITHUB = "https://github.com/Ratheshprabakar/AgentLens";
const CURL_INSTALL = installCommand();

export default function Hero() {
  const [copied, setCopied] = useState(false);
  const reduce = useReducedMotion();

  const copyAndJump = async () => {
    try {
      await navigator.clipboard.writeText(CURL_INSTALL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* ignore */
    }
    document
      .getElementById("install")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="hero">
      <div className="hero__row wrap">
        <motion.div
          className="hero__copy"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          <motion.p className="hero__brand" variants={fadeUp}>
            AgentLens
          </motion.p>
          <motion.h1 className="hero__headline" variants={fadeUp}>
            Your coding agent has a timeline. You just couldn&apos;t see it.
          </motion.h1>
          <motion.p className="hero__sub" variants={fadeUp}>
            AgentLens is local DevTools for AI coding agents. Every prompt,
            edit, shell command, and search - in order - so you can see where
            time went and where it got stuck.
          </motion.p>
          <motion.div className="hero__ctas" variants={fadeUp}>
            <motion.button
              type="button"
              className="btn btn--primary"
              onClick={() => void copyAndJump()}
              whileHover={reduce ? undefined : { y: -1 }}
              whileTap={reduce ? undefined : { scale: 0.98 }}
              transition={{ duration: 0.15 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={copied ? "ok" : "go"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  {copied ? "Copied - paste below" : "Install in one minute"}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <motion.a
              className="btn btn--ghost"
              href={GITHUB}
              target="_blank"
              rel="noopener noreferrer"
              whileHover={reduce ? undefined : { y: -1 }}
              whileTap={reduce ? undefined : { scale: 0.98 }}
            >
              View on GitHub
            </motion.a>
          </motion.div>
          <motion.p className="hero__hint mono" variants={fadeUp}>
            One command · opens in your browser · data stays on your machine
          </motion.p>
        </motion.div>

        <motion.div
          className="hero__visual"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.12, ease: easeOut }}
        >
          <ProductMock />
        </motion.div>
      </div>
    </section>
  );
}

type MockRow = {
  id: string;
  t: string;
  kind: string;
  label: string;
  body: string;
};

const SEED: MockRow[] = [
  {
    id: "s1",
    t: "00:02",
    kind: "prompt",
    label: "prompt",
    body: "Fix the sessions list density…",
  },
  {
    id: "s2",
    t: "00:05",
    kind: "read",
    label: "read",
    body: "web/src/pages/Sessions.tsx",
  },
  {
    id: "s3",
    t: "00:11",
    kind: "edit",
    label: "edit",
    body: "Sessions.css  +42 −18",
  },
  {
    id: "s4",
    t: "00:18",
    kind: "shell",
    label: "shell",
    body: "pnpm run build:web",
  },
  {
    id: "s5",
    t: "00:24",
    kind: "search",
    label: "search",
    body: "showNotes · Session.tsx",
  },
];

const INCOMING: Omit<MockRow, "id">[] = [
  { t: "00:31", kind: "edit", label: "edit", body: "Session.tsx  +12 −3" },
  { t: "00:38", kind: "shell", label: "shell", body: "pnpm run dev:landing" },
  {
    t: "00:44",
    kind: "read",
    label: "read",
    body: "landing/src/components/Hero.tsx",
  },
  {
    t: "00:52",
    kind: "prompt",
    label: "prompt",
    body: "Tighten the hero spacing…",
  },
  {
    t: "01:01",
    kind: "search",
    label: "search",
    body: "framer-motion · layout",
  },
];

function ProductMock() {
  const reduce = useReducedMotion();
  const [rows, setRows] = useState(SEED);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setSeq((n) => n + 1), 2400);
    return () => window.clearInterval(id);
  }, [reduce]);

  useEffect(() => {
    if (reduce || seq === 0) return;
    const next = INCOMING[(seq - 1) % INCOMING.length];
    setRows((prev) => [...prev.slice(1), { ...next, id: `n${seq}` }]);
  }, [seq, reduce]);

  return (
    <div className="mock">
      <div className="mock__chrome">
        <span className="mock__live">
          <motion.span
            className="mock__live-dot"
            animate={reduce ? undefined : { opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="mono">live session</span>
        </span>
        <span className="mock__title mono">agent · agentlens</span>
      </div>
      <div className="mock__body">
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map((r) => (
            <motion.div
              key={r.id}
              className={`mock__row mock__row--${r.kind}`}
              layout="position"
              initial={reduce ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -8 }}
              transition={{ duration: 0.28, ease: easeOut }}
            >
              <span className="mock__rail" />
              <span className="mock__time mono">{r.t}</span>
              <span className={`mock__tag mono mock__tag--${r.kind}`}>
                {r.label}
              </span>
              <span className="mock__text truncate">{r.body}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
