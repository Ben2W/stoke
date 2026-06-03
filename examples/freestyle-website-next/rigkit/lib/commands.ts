import {
  devEnvironmentPath,
  repoPath,
  shpoolSocketPath,
  shpoolVersion,
  vmHome,
} from "./config";
import { dirname, shellQuote } from "./shell";

export function installAptDependenciesCommand(): string {
  return `
set -e
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg
mkdir -p /etc/apt/keyrings /usr/local/bin

curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/github-cli.list

rm -f /etc/apt/keyrings/nodesource.gpg
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\\n' > /etc/apt/sources.list.d/nodesource.list

apt-get update -qq
apt-get install -y -qq build-essential ca-certificates curl gh git gnupg pkg-config python3 unzip xz-utils

nodejs_version=$(apt-cache madison nodejs | awk '$3 ~ /^22[.]/ { print $3; exit }')
if [ -z "$nodejs_version" ]; then
  echo "could not find a Node.js 22.x package candidate" >&2
  apt-cache policy nodejs >&2
  exit 1
fi
apt-get install -y -qq --allow-downgrades "nodejs=$nodejs_version"

for bin in node npm npx corepack; do
  if [ -x "/usr/bin/$bin" ]; then
    ln -sf "/usr/bin/$bin" "/usr/local/bin/$bin"
  fi
done
hash -r

corepack enable
export HOME=/root
export PATH="/usr/local/bin:/root/.local/bin:/opt/bun/bin:$PATH"
npm config set prefix /usr/local
git config --system init.defaultBranch main

node_version=$(node --version)
echo "using Node.js $node_version from $(command -v node)"
case "$node_version" in
  v22.*) ;;
  *) echo "expected Node.js v22.x, got $node_version" >&2; exit 1 ;;
esac

rm -rf /var/lib/apt/lists/*
`;
}

export function installJavaScriptToolsCommand(): string {
  return `
set -e
export HOME=/root
export PATH="/usr/local/bin:/root/.local/bin:/opt/bun/bin:$PATH"
npm config set prefix /usr/local

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

echo "verifying node"
node_version=$(node --version)
echo "$node_version"
case "$node_version" in
  v22.*) ;;
  *) echo "expected Node.js v22.x, got $node_version" >&2; exit 1 ;;
esac

echo "installing bun"
curl -fsSL https://bun.sh/install -o "$tmp_dir/install-bun.sh"
BUN_INSTALL=/opt/bun bash "$tmp_dir/install-bun.sh"
ln -sf /opt/bun/bin/bun /usr/local/bin/bun

echo "installing codex"
npm install -g @openai/codex
mkdir -p /root/.codex
printf 'cli_auth_credentials_store = "file"\\n' > /root/.codex/config.toml

echo "verifying bun"
command -v bun
bun --version

echo "verifying codex"
command -v codex
codex --version
`;
}

export function installShpoolCommand(): string {
  return `
set -e
export HOME=/root
export PATH="/usr/local/bin:/root/.local/bin:/opt/bun/bin:/root/.cargo/bin:$PATH"

curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.85.0
. /root/.cargo/env
cargo install shpool --locked --version ${shpoolVersion}

mkdir -p /usr/local/bin
ln -sf /root/.cargo/bin/shpool /usr/local/bin/shpool
shpool version
`;
}

export function verifySystemDependenciesCommand(): string {
  return `
set -e
export HOME=/root
export PATH="/usr/local/bin:/root/.local/bin:/opt/bun/bin:/root/.cargo/bin:$PATH"

command -v node
command -v bun
command -v codex
command -v shpool
node --version | grep -E '^v22\\.'
bun --version
codex --version
shpool version
`;
}

// vm.exec does not set HOME, so set it explicitly for commands that expect it.
export function withVmHome(command: string): string {
  return `HOME=${shellQuote(vmHome)} ${command}`;
}

export function agentCliInitCommand(command: "codex"): string {
  return [
    "set -e",
    `export HOME=${shellQuote(vmHome)}`,
    `cd ${shellQuote(repoPath)}`,
    command,
  ].join("\n");
}

export function updateCodexCliAndEnableGoalsCommand(): string {
  const configPath = `${vmHome}/.codex/config.toml`;
  return [
    "set -e",
    `export HOME=${shellQuote(vmHome)}`,
    `export PATH=${shellQuote(devEnvironmentPath)}:"$PATH"`,
    "npm config set prefix /usr/local",
    "npm install -g @openai/codex@latest",
    `mkdir -p ${shellQuote(dirname(configPath))}`,
    `touch ${shellQuote(configPath)}`,
    `python3 - ${shellQuote(configPath)} <<'PY'`,
    "from pathlib import Path",
    "import re",
    "import sys",
    "",
    "path = Path(sys.argv[1])",
    "lines = path.read_text().splitlines() if path.exists() else []",
    "out = []",
    "in_features = False",
    "saw_features = False",
    "set_goals = False",
    "",
    "for line in lines:",
    "    stripped = line.strip()",
    "    is_header = stripped.startswith('[') and stripped.endswith(']') and not stripped.startswith('[[')",
    "    if stripped == '[features]':",
    "        in_features = True",
    "        saw_features = True",
    "        out.append(line)",
    "        continue",
    "    if in_features and is_header:",
    "        if not set_goals:",
    "            out.append('goals = true')",
    "            set_goals = True",
    "        in_features = False",
    "    if in_features and re.match(r'^goals\\s*=', stripped):",
    "        if not set_goals:",
    "            out.append('goals = true')",
    "            set_goals = True",
    "        continue",
    "    out.append(line)",
    "",
    "if in_features and not set_goals:",
    "    out.append('goals = true')",
    "if not saw_features:",
    "    if out and out[-1] != '':",
    "        out.append('')",
    "    out.extend(['[features]', 'goals = true'])",
    "",
    "path.write_text('\\n'.join(out).rstrip() + '\\n')",
    "PY",
    `grep -Eq ${shellQuote("^[[:space:]]*goals[[:space:]]*=[[:space:]]*true[[:space:]]*$")} ${shellQuote(configPath)}`,
    "codex --version",
  ].join("\n");
}

export function configureGitIdentityCommand(): string {
  return [
    "set -e",
    `export HOME=${shellQuote(vmHome)}`,
    "login=$(gh api user --jq '.login')",
    "name=$(gh api user --jq '.name // empty')",
    "id=$(gh api user --jq '.id')",
    "email=$(gh api user --jq '.email // empty')",
    'if [ -z "$name" ]; then name="$login"; fi',
    'if [ -z "$email" ]; then email="${id}+${login}@users.noreply.github.com"; fi',
    'git config --global user.name "$name"',
    'git config --global user.email "$email"',
  ].join("\n");
}

export function startDevServerSessionCommand(options: {
  repoPath: string;
  command: string;
  sessionName: string;
}): string {
  const shpoolClientLogPath = "/tmp/shpool-dev-server-client.log";
  const shpoolDaemonLogPath = `${vmHome}/.local/run/shpool/daemonized-shpool.log`;
  const shpool = `shpool --socket ${shellQuote(shpoolSocketPath)} --log-file ${shellQuote(shpoolClientLogPath)} -vv`;
  return [
    "set -eu",
    `export HOME=${shellQuote(vmHome)}`,
    `export PATH=${shellQuote(devEnvironmentPath)}:"$PATH"`,
    `mkdir -p ${shellQuote(`${vmHome}/.config/shpool`)}`,
    `printf '%s\\n' ${shellQuote(`initial_path = "${devEnvironmentPath}"`)} > ${shellQuote(`${vmHome}/.config/shpool/config.toml`)}`,
    "command -v shpool",
    "shpool version",
    `cd ${shellQuote(options.repoPath)}`,
    `rm -f ${shellQuote(shpoolClientLogPath)} ${shellQuote(shpoolDaemonLogPath)}`,
    `${shpool} kill ${shellQuote(options.sessionName)} >/dev/null 2>&1 || true`,
    "set +e",
    `${shpool} attach --background --force --dir ${shellQuote(options.repoPath)} --cmd ${shellQuote(options.command)} ${shellQuote(options.sessionName)}`,
    "status=$?",
    "set -e",
    'if [ "$status" -ne 0 ]; then',
    '  echo "shpool attach failed with status $status" >&2',
    `  ${shpool} list >&2 || true`,
    `  if [ -f ${shellQuote(shpoolClientLogPath)} ]; then`,
    '    echo "shpool client log:" >&2',
    `    sed -n '1,240p' ${shellQuote(shpoolClientLogPath)} >&2`,
    "  fi",
    `  if [ -f ${shellQuote(shpoolDaemonLogPath)} ]; then`,
    '    echo "shpool daemon log:" >&2',
    `    sed -n '1,240p' ${shellQuote(shpoolDaemonLogPath)} >&2`,
    "  fi",
    '  exit "$status"',
    "fi",
    `${shpool} list`,
  ].join("\n");
}

export function attachDevServerSessionCommand(sessionName: string): string {
  return [
    "set -e",
    `export HOME=${shellQuote(vmHome)}`,
    `export PATH=${shellQuote(devEnvironmentPath)}:"$PATH"`,
    `shpool --socket ${shellQuote(shpoolSocketPath)} list | awk 'NR > 1 {print $1}' | grep -Fxq ${shellQuote(sessionName)}`,
    `exec shpool --socket ${shellQuote(shpoolSocketPath)} attach -f ${shellQuote(sessionName)}`,
  ].join("\n");
}
