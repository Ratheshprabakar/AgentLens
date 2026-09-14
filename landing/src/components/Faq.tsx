import { useState } from "react";
import { motion } from "framer-motion";
import { fadeUp, stagger, viewportOnce, easeOut } from "../lib/motion";
import "./Faq.css";

const FAQS = [
  {
    q: "What is AgentLens?",
    a: "Local DevTools for AI coding agents. It turns a session into a timeline of prompts, edits, shell commands, and searches - so you can see where time went and where it got stuck.",
  },
  {
    q: "Does my data leave my machine?",
    a: "No. AgentLens runs on your computer. Sessions stay on your box - no account, no cloud upload.",
  },
  {
    q: "What do I need to install?",
    a: "Docker Desktop and a terminal. Paste the one-line install command - it pulls the image, starts AgentLens, and opens the dashboard. Then run your agent as usual.",
  },
  {
    q: "Do I run the install command every time?",
    a: "No. Run it once. After that, start or stop the agentlens container in Docker Desktop and open the dashboard when you need it. Re-run install only to update, or if you removed the container.",
  },
  {
    q: "Why a curl install instead of typing docker run?",
    a: "That’s the usual pattern for local developer tools. The script hides the long Docker flags so you don’t have to type volume mounts. Under the hood it still runs the official image on your machine.",
  },
  {
    q: "What if the default port is already in use?",
    a: "Install with a free port, for example: PORT=4050 curl -sSL https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/master/scripts/install.sh | bash - then open the dashboard on that port.",
  },
  {
    q: "Which agents work today?",
    a: "Claude Code (live capture) and Cursor (import past sessions). See Supported Agents above - we’ll add more there as they land.",
  },
  {
    q: "Can I look at sessions I already ran?",
    a: "Yes. AgentLens can import history from the agent folders mounted at install time and rebuild the timeline - no need to re-run those sessions.",
  },
  {
    q: "How do I stop or uninstall?",
    a: "Stop with docker stop agentlens. Remove the container with docker rm agentlens (data is kept). Delete stored sessions with docker volume rm agentlens-data. To remove Claude Code hooks only, run the install script with --uninstall-hooks - see the GitHub README.",
  },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="faq" id="faq">
      <div className="wrap">
        <motion.div
          className="faq__intro"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.h2 className="faq__heading" variants={fadeUp}>
            FAQ
          </motion.h2>
          <motion.p className="faq__sub" variants={fadeUp}>
            Short answers before you paste the install command.
          </motion.p>
        </motion.div>

        <motion.div
          className="faq__list"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={viewportOnce}
          transition={{ duration: 0.4, ease: easeOut }}
        >
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={item.q}
                className={`faq__item ${isOpen ? "faq__item--open" : ""}`}
              >
                <button
                  type="button"
                  className="faq__q"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span>{item.q}</span>
                  <span
                    className={`faq__icon mono ${isOpen ? "faq__icon--open" : ""}`}
                    aria-hidden
                  >
                    +
                  </span>
                </button>
                <div
                  className="faq__a-wrap"
                  data-open={isOpen ? "true" : "false"}
                >
                  <div className="faq__a-inner">
                    <p className="faq__a">{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
