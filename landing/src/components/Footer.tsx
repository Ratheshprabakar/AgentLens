import "./Footer.css";

const LINKEDIN = "https://linkedin.com/in/Ratheshprabakar";
const GITHUB = "https://github.com/Ratheshprabakar/AgentLens";

export default function Footer() {
  return (
    <footer className="site-foot">
      <div className="site-foot__inner wrap">
        <div className="site-foot__left">
          <span className="site-foot__brand mono">AgentLens</span>
          <span className="site-foot__sep" aria-hidden>
            ·
          </span>
          <span className="mono">v1.0.0</span>
          <span className="site-foot__sep" aria-hidden>
            ·
          </span>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <span className="site-foot__sep" aria-hidden>
            ·
          </span>
          <span>local observatory</span>
        </div>
        <a
          className="site-foot__credit"
          href={LINKEDIN}
          target="_blank"
          rel="noopener noreferrer"
        >
          Made with love by Rathesh Prabakar
        </a>
      </div>
    </footer>
  );
}
