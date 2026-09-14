/** Canonical install URL while the GitHub repo is public. */
export const INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/Ratheshprabakar/AgentLens/main/scripts/install.sh";

export function installCommand(): string {
  return `curl -sSL ${INSTALL_SCRIPT_URL} | bash`;
}

export function uninstallCommand(): string {
  return `curl -sSL ${INSTALL_SCRIPT_URL} | bash -s -- --uninstall-hooks`;
}
