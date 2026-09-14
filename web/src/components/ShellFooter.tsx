/** Quiet chrome footer - matches shell-top on Sessions + Session. */
export default function ShellFooter() {
  return (
    <footer className="shell-foot">
      <div className="shell-foot__inner">
        <div className="shell-foot__left">
          <span className="shell-foot__brand mono">AgentLens</span>
          <span className="shell-foot__sep" aria-hidden>
            ·
          </span>
          <span className="mono">v1.0.0</span>
          <span className="shell-foot__sep" aria-hidden>
            ·
          </span>
          <span>local observatory · data stays on this machine</span>
        </div>

        <a
          className="shell-foot__credit"
          href="https://linkedin.com/in/Ratheshprabakar"
          target="_blank"
          rel="noopener noreferrer"
        >
          Made with love by Rathesh Prabakar
        </a>
      </div>
    </footer>
  );
}
