import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import { useState } from "react";
import Hero from "../components/Hero";
import Bridge from "../components/Bridge";
import Features from "../components/Features";
import Supported from "../components/Supported";
import Install from "../components/Install";
import Faq from "../components/Faq";
import Footer from "../components/Footer";
import "./Home.css";

export default function Home() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => {
    setScrolled(y > 12);
  });

  return (
    <div className="home">
      <motion.header
        className={`home__nav ${scrolled ? "home__nav--scrolled" : ""}`}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="home__nav-inner wrap">
          <a href="#top" className="home__nav-brand" aria-label="AgentLens home">
            <span className="home__nav-mark" aria-hidden />
            <span className="home__nav-name">AgentLens</span>
          </a>
          <nav className="home__nav-links" aria-label="Page">
            <a href="#features">Features</a>
            <a href="#supported">Agents</a>
            <a href="#faq">FAQ</a>
            <a href="#install" className="home__nav-cta">
              Install
            </a>
          </nav>
        </div>
      </motion.header>

      <main id="top">
        <Hero />
        <Bridge />
        <Features />
        <Supported />
        <Install />
        <Faq />
      </main>

      <Footer />
    </div>
  );
}
