#!/usr/bin/env bash
#
# Context101 — MCP team installer
#
# Bootstraps a teammate's machine with the toolchain + Claude Desktop
# configuration for our team's MCP servers (Context101, Metabase,
# Google Analytics, AWS Docs, plus optional Iterable / Sentry).
#
# Idempotent: re-running skips anything already installed and only
# updates the Claude Desktop config for the MCPs you re-confirm.
#
# Usage:
#   ./scripts/install-mcps.sh
#   ./scripts/install-mcps.sh --dry-run     # show what would happen, change nothing
#   ./scripts/install-mcps.sh --yes         # accept all prerequisite installs
#                                           # (still asks per-MCP for creds)
#
# Supported: macOS (Apple Silicon + Intel). Linux/WSL would need path tweaks.

set -euo pipefail

# ── Flags ─────────────────────────────────────────────────────────────

DRY_RUN=false
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes|-y)  ASSUME_YES=true ;;
    --help|-h)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ── Output helpers ────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
  GREEN=$'\033[32m'; BLUE=$'\033[34m'; YELLOW=$'\033[33m'; RED=$'\033[31m'
else
  BOLD=''; DIM=''; RESET=''; GREEN=''; BLUE=''; YELLOW=''; RED=''
fi

step()    { printf "\n${BOLD}${BLUE}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
ok()      { printf "  ${GREEN}✓${RESET} %s\n" "$*"; }
skip()    { printf "  ${DIM}·${RESET} ${DIM}%s${RESET}\n" "$*"; }
warn()    { printf "  ${YELLOW}!${RESET} %s\n" "$*"; }
err()     { printf "  ${RED}✗${RESET} %s\n" "$*" >&2; }
hr()      { printf "${DIM}%s${RESET}\n" "------------------------------------------------------------"; }

run() {
  if $DRY_RUN; then
    printf "  ${DIM}\$ %s${RESET}\n" "$*"
  else
    eval "$@"
  fi
}

confirm() {
  # confirm "Prompt" [default Y|N]
  local prompt="$1" default="${2:-Y}" reply
  if $ASSUME_YES; then echo "y"; return 0; fi
  if [[ "$default" == "Y" ]]; then
    read -r -p "  ${prompt} [Y/n] " reply
    [[ -z "$reply" || "$reply" =~ ^[Yy] ]] && return 0 || return 1
  else
    read -r -p "  ${prompt} [y/N] " reply
    [[ "$reply" =~ ^[Yy] ]] && return 0 || return 1
  fi
}

read_value() {
  # read_value "Prompt" [default]
  local prompt="$1" default="${2:-}" reply
  if [[ -n "$default" ]]; then
    read -r -p "  ${prompt} [${default}] " reply
    echo "${reply:-$default}"
  else
    read -r -p "  ${prompt} " reply
    echo "$reply"
  fi
}

read_secret() {
  # read_secret "Prompt"
  local prompt="$1" reply
  read -r -s -p "  ${prompt} " reply
  echo >&2  # newline after silent input
  echo "$reply"
}

# ── OS guard ──────────────────────────────────────────────────────────

if [[ "$(uname -s)" != "Darwin" ]]; then
  err "This script targets macOS. Open a PR if you'd like Linux support."
  exit 1
fi

# ── Intro ─────────────────────────────────────────────────────────────

cat <<'EOF'

   ____            _            _    _  ___  _
  / ___|___  _ __ | |_ _____  _| |_ / |/ _ \/ |
 | |   / _ \| '_ \| __/ _ \ \/ / __|| | | | | |
 | |__| (_) | | | | ||  __/>  <| |_ | | |_| | |
  \____\___/|_| |_|\__\___/_/\_\\__||_|\___/|_|

  MCP installer for the team

This will:
  1. Make sure Homebrew is installed (or skip if you already have it)
  2. Install: jq, uv (uvx), pipx, gcloud, nvm + Node 20 — only what's missing
  3. Show a numbered menu of MCPs and let you pick which to install:
       · Context101         (team knowledge base)
       · AWS Docs           (no creds)
       · Metabase           (URL + API key)
       · Google Analytics   (creds JSON + project ID)
       · Contentful         (CMS — Management API token)
       · Iterable           (URL + token)
       · Sentry (hosted)    (OAuth in browser)
     You can pick all, none, individual numbers, or ranges.
  4. Merge them into your Claude Desktop config
       (~/Library/Application Support/Claude/claude_desktop_config.json)
     A timestamped backup is taken first.

Re-running is safe — it skips what's done and only touches the
mcpServers you re-confirm.

EOF

if ! $DRY_RUN && ! confirm "Proceed?"; then
  echo "Aborted."
  exit 0
fi

# ── 1. Homebrew ───────────────────────────────────────────────────────

step "Homebrew"

if command -v brew >/dev/null 2>&1; then
  ok "Homebrew already installed ($(brew --version | head -n1))"
else
  warn "Homebrew not found."
  if confirm "Install Homebrew now?"; then
    run '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    # Add brew to PATH for this session (Apple Silicon vs Intel)
    if [[ -x /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew installed"
  else
    err "Homebrew is required for the rest of this script. Aborting."
    exit 1
  fi
fi

# ── 2. CLI prerequisites ──────────────────────────────────────────────

ensure_brew_pkg() {
  # ensure_brew_pkg <formula> <command-to-test>
  local formula="$1" cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$formula already installed ($(command -v "$cmd"))"
  else
    if $ASSUME_YES || confirm "Install $formula via brew?"; then
      run "brew install $formula"
      ok "$formula installed"
    else
      skip "$formula skipped (you'll need it to configure related MCPs)"
    fi
  fi
}

ensure_brew_cask() {
  local cask="$1" cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cask already installed ($(command -v "$cmd"))"
  else
    if $ASSUME_YES || confirm "Install $cask (cask) via brew?"; then
      run "brew install --cask $cask"
      ok "$cask installed"
    else
      skip "$cask skipped"
    fi
  fi
}

step "Prerequisites"
ensure_brew_pkg jq    jq
ensure_brew_pkg uv    uv          # gives us uvx
ensure_brew_pkg pipx  pipx
# pipx puts shims under ~/.local/bin — make sure it's on PATH for the
# current login shells. `pipx ensurepath` is idempotent.
if command -v pipx >/dev/null 2>&1; then
  run "pipx ensurepath >/dev/null 2>&1 || true"
fi
# gcloud is only needed for the Google Analytics MCP (ADC). Cask name
# is google-cloud-sdk; the binary is `gcloud`.
ensure_brew_cask google-cloud-sdk gcloud

# ── 3. nvm + Node 20 (for npm/npx-based MCPs incl. mcp-remote) ────────

step "nvm + Node 20"

# nvm is a shell function, not a binary. Test by sourcing the install path.
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  ok "nvm already installed ($NVM_DIR)"
else
  if $ASSUME_YES || confirm "Install nvm?"; then
    run "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
    ok "nvm installed"
  else
    skip "nvm skipped"
  fi
fi

# shellcheck disable=SC1091
[[ -s "$NVM_DIR/nvm.sh" ]] && \. "$NVM_DIR/nvm.sh" || true

if command -v node >/dev/null 2>&1 && [[ "$(node -v)" =~ ^v(2[0-9]|[3-9][0-9])\. ]]; then
  ok "Node $(node -v) already active"
elif command -v nvm >/dev/null 2>&1 || type nvm >/dev/null 2>&1; then
  if $ASSUME_YES || confirm "Install Node 20 via nvm?"; then
    run "nvm install 20 >/dev/null && nvm use 20 >/dev/null"
    ok "Node $(node -v 2>/dev/null || echo 'installed (open a new shell to use)')"
  fi
else
  warn "Couldn't load nvm; open a new shell and re-run if you want Node installed."
fi

# ── 4. MCP picker ─────────────────────────────────────────────────────

step "MCP servers"

# The catalog. Three parallel indexed arrays (kept in sync by index)
# rather than associative arrays — works on macOS's default bash 3.2.
# Add a new MCP by appending one row to each, in the same position,
# and a matching `is_selected <id>` block lower down.
MCP_IDS=(
  "context101"
  "aws-docs"
  "metabase"
  "google-analytics"
  "contentful"
  "iterable"
  "sentry"
)
MCP_LABELS=(
  "Context101"
  "AWS Documentation"
  "Metabase"
  "Google Analytics"
  "Contentful"
  "Iterable"
  "Sentry (hosted)"
)
MCP_DESCS=(
  "team knowledge base — needs URL + bearer token"
  "AWS product docs — no creds"
  "Metabase queries — needs URL + API key"
  "GA reports — paste creds JSON + project ID"
  "Contentful CMS — needs management API token"
  "Iterable API — optional, needs URL + token"
  "Sentry hosted MCP — optional, OAuth in browser"
)

# Print the menu, then read selection.
echo
echo "  ${BOLD}Available MCPs${RESET}"
hr
i=0
while [[ $i -lt ${#MCP_IDS[@]} ]]; do
  num=$((i + 1))
  printf "    %2d) %-20s %s\n" "$num" "${MCP_LABELS[$i]}" "${DIM}${MCP_DESCS[$i]}${RESET}"
  i=$((i + 1))
done
hr
cat <<'EOF'
  Pick which to install. Examples:
    1 3 5        single picks (space- or comma-separated)
    1-4          a range
    1,3-5        mixed
    all          everything
    none         skip and just write the existing config
EOF

SELECTED_IDS=""   # space-padded list of selected ids — bash 3.2 friendly
TOTAL=${#MCP_IDS[@]}

# bash 3.2 has no ${var,,} — use tr for lowercase.
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

select_id() {
  case " $SELECTED_IDS " in
    *" $1 "*) return 0 ;;  # already in
    *) SELECTED_IDS="$SELECTED_IDS $1" ;;
  esac
}

while true; do
  raw=$(read_value "Selection")
  raw=$(lower "$raw")
  raw="${raw// /,}"   # spaces → commas
  # collapse runs of commas via parameter substitution loop
  while [[ "$raw" == *,,* ]]; do raw="${raw//,,/,}"; done
  raw="${raw#,}"; raw="${raw%,}"
  if [[ -z "$raw" ]]; then
    warn "Empty — try again, or type 'none' to skip."
    continue
  fi
  if [[ "$raw" == "all" ]]; then
    for id in "${MCP_IDS[@]}"; do select_id "$id"; done
    break
  fi
  if [[ "$raw" == "none" ]]; then
    break
  fi
  # Parse comma-separated tokens; each token is either N or N-M.
  bad=false
  IFS=',' read -ra parts <<< "$raw"
  for p in "${parts[@]}"; do
    if [[ "$p" =~ ^[0-9]+$ ]]; then
      n="$p"
      if (( n < 1 || n > TOTAL )); then bad=true; break; fi
      select_id "${MCP_IDS[$((n-1))]}"
    elif [[ "$p" =~ ^([0-9]+)-([0-9]+)$ ]]; then
      lo="${BASH_REMATCH[1]}"; hi="${BASH_REMATCH[2]}"
      if (( lo < 1 || hi > TOTAL || lo > hi )); then bad=true; break; fi
      n=$lo
      while [[ $n -le $hi ]]; do
        select_id "${MCP_IDS[$((n-1))]}"
        n=$((n + 1))
      done
    else
      bad=true; break
    fi
  done
  if $bad; then
    SELECTED_IDS=""
    err "Couldn't parse '$raw' — use numbers 1-$TOTAL, ranges (1-3), 'all', or 'none'."
    continue
  fi
  break
done

# Trim leading space so a single-token selection prints nicely.
SELECTED_IDS="${SELECTED_IDS# }"

if [[ -z "$SELECTED_IDS" ]]; then
  warn "Nothing selected — skipping per-MCP configuration."
else
  echo
  echo "  ${BOLD}Will configure:${RESET}"
  i=0
  while [[ $i -lt ${#MCP_IDS[@]} ]]; do
    id="${MCP_IDS[$i]}"
    case " $SELECTED_IDS " in
      *" $id "*) printf "    · %s\n" "${MCP_LABELS[$i]}" ;;
    esac
    i=$((i + 1))
  done
  echo
fi

is_selected() {
  case " $SELECTED_IDS " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# Each "ADD_*" var holds a JSON object that will become one mcpServers entry,
# keyed by SERVER_KEY. We'll merge them into the Claude Desktop config below.
declare -a SERVER_KEYS=()
declare -a SERVER_JSONS=()

add_server() {
  # add_server <key> <json>
  SERVER_KEYS+=("$1")
  SERVER_JSONS+=("$2")
}

# ── 4a. Context101 ────────────────────────────────────────────────────

if is_selected context101; then
  step "Context101"
  CTX_URL=$(read_value "Context101 MCP URL" "https://wd3y3hnp7s.us-east-1.awsapprunner.com/mcp")
  CTX_TOKEN=$(read_secret "Bearer token (ask in #context101 if you don't have it):")
  if [[ -z "$CTX_TOKEN" ]]; then
    warn "Empty token — skipping Context101"
  else
    # Claude Desktop only speaks stdio, so we proxy via mcp-remote (npx).
    add_server "context101" "$(jq -n \
      --arg url "$CTX_URL" \
      --arg auth "Authorization: Bearer $CTX_TOKEN" \
      '{
        command: "npx",
        args: ["-y", "mcp-remote", $url, "--header", $auth]
      }')"
    ok "Context101 queued"
  fi
fi

# ── 4b. AWS Docs ──────────────────────────────────────────────────────

if is_selected aws-docs; then
  step "AWS Documentation"
  add_server "awslabs.aws-documentation-mcp-server" "$(jq -n '{
    command: "uvx",
    args: ["awslabs.aws-documentation-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR", AWS_DOCUMENTATION_PARTITION: "aws" }
  }')"
  ok "AWS Docs queued"
fi

# ── 4c. Metabase ──────────────────────────────────────────────────────

if is_selected metabase; then
  step "Metabase"
  MB_URL=$(read_value "Metabase URL" "https://metabase.finditpr.com")
  MB_KEY=$(read_secret "Metabase API key (Account → Account settings → API Keys):")
  if [[ -z "$MB_KEY" ]]; then
    warn "Empty API key — skipping Metabase"
  else
    add_server "metabase" "$(jq -n \
      --arg url "$MB_URL" \
      --arg key "$MB_KEY" \
      '{
        type: "stdio",
        command: "uvx",
        args: ["metabase-mcp"],
        env: { METABASE_URL: $url, METABASE_API_KEY: $key }
      }')"
    ok "Metabase queued"
  fi
fi

# ── 4d. Google Analytics ──────────────────────────────────────────────

if is_selected google-analytics; then
  step "Google Analytics"

  # The team-default project ID — overridable but most teammates can
  # accept it.
  GA_DEFAULT_PROJECT="348391748"
  GA_DEFAULT_CREDS_PATH="$HOME/Documents/claude-ga-mcp-creds.json"

  cat <<'EOF'

  The GA MCP authenticates with a Google Cloud credentials JSON file —
  either a service-account key or an OAuth client/ADC file. We'll save
  it to ~/Documents/claude-ga-mcp-creds.json and point the MCP at it.

  If you don't have a credentials JSON yet, ask in #context101 for the
  team's service-account file.

EOF

  GA_PROJECT=$(read_value "Google Cloud project ID" "$GA_DEFAULT_PROJECT")
  GA_CREDS_PATH=$(read_value "Where to save the credentials file" "$GA_DEFAULT_CREDS_PATH")

  # Multi-line paste loop. Read until a single line containing only
  # "EOF" — same convention as a heredoc terminator and keeps the user
  # in control of when paste ends.
  cat <<'EOF'

  Paste the entire credentials JSON below. When you're done, press
  Enter and type EOF on its own line, then Enter again.

EOF
  GA_CREDS_BODY=""
  while IFS= read -r line; do
    if [[ "$line" == "EOF" ]]; then break; fi
    GA_CREDS_BODY+="$line"$'\n'
  done

  # Trim trailing newline so jq sees a single JSON value.
  GA_CREDS_BODY="${GA_CREDS_BODY%$'\n'}"

  if [[ -z "$GA_CREDS_BODY" ]]; then
    err "No credentials pasted — skipping Google Analytics."
  elif ! printf '%s' "$GA_CREDS_BODY" | jq empty >/dev/null 2>&1; then
    err "What you pasted isn't valid JSON. Run again and paste the file's contents verbatim."
  else
    if $DRY_RUN; then
      printf "  ${DIM}\$ would write %s (%d bytes)${RESET}\n" \
        "$GA_CREDS_PATH" "${#GA_CREDS_BODY}"
    else
      mkdir -p "$(dirname "$GA_CREDS_PATH")"
      # 0600 — only the current user can read; this is a credential.
      umask 077
      printf '%s' "$GA_CREDS_BODY" > "$GA_CREDS_PATH"
      chmod 600 "$GA_CREDS_PATH"
      umask 022
      ok "Wrote $GA_CREDS_PATH (mode 600)"
    fi

    add_server "analytics-mcp" "$(jq -n \
      --arg adc "$GA_CREDS_PATH" \
      --arg proj "$GA_PROJECT" \
      '{
        command: "pipx",
        args: ["run", "analytics-mcp"],
        env: {
          GOOGLE_APPLICATION_CREDENTIALS: $adc,
          GOOGLE_PROJECT_ID: $proj,
          GOOGLE_CLOUD_PROJECT: $proj
        }
      }')"
    ok "Google Analytics queued (project=$GA_PROJECT)"
  fi
fi

# ── 4e. Contentful ────────────────────────────────────────────────────

if is_selected contentful; then
  step "Contentful"
  CF_SPACE=$(read_value "Contentful space ID" "mj6ykc7haq31")
  CF_ENV=$(read_value "Contentful environment ID" "master")
  CF_HOST=$(read_value "Contentful host" "https://api.contentful.com")
  CF_TOKEN=$(read_secret "Contentful Management API token (Settings → API keys → Content management tokens):")
  if [[ -z "$CF_TOKEN" ]]; then
    warn "Empty token — skipping Contentful"
  else
    add_server "contentful-mcp" "$(jq -n \
      --arg token "$CF_TOKEN" \
      --arg space "$CF_SPACE" \
      --arg env "$CF_ENV" \
      --arg host "$CF_HOST" \
      '{
        command: "npx",
        args: ["-y", "@contentful/mcp-server"],
        env: {
          CONTENTFUL_MANAGEMENT_ACCESS_TOKEN: $token,
          SPACE_ID: $space,
          ENVIRONMENT_ID: $env,
          CONTENTFUL_HOST: $host
        }
      }')"
    ok "Contentful queued (space=$CF_SPACE, env=$CF_ENV)"
  fi
fi

# ── 4f. Iterable (optional) ──────────────────────────────────────────

# (Iterable was 4e in earlier revisions — renumbered when Contentful
# slotted in; ordering matches the catalog above.)

if is_selected iterable; then
  step "Iterable"
  cat <<'EOF'

  Iterable's MCP isn't in our context101 docs yet — give us:
    · the MCP URL (HTTP) or stdio command
    · an Iterable API key

  If you have a stdio installer (e.g. an internal package), pick "stdio"
  below. Otherwise pick "http" and paste the team URL.

EOF
  IT_MODE=$(read_value "Mode: http / stdio / skip" "http")
  case "$IT_MODE" in
    http)
      IT_URL=$(read_value "Iterable MCP URL")
      IT_TOKEN=$(read_secret "Iterable API key:")
      if [[ -n "$IT_URL" && -n "$IT_TOKEN" ]]; then
        add_server "iterable" "$(jq -n \
          --arg url "$IT_URL" \
          --arg auth "Authorization: Bearer $IT_TOKEN" \
          '{
            command: "npx",
            args: ["-y", "mcp-remote", $url, "--header", $auth]
          }')"
        ok "Iterable queued (HTTP via mcp-remote)"
      fi
      ;;
    stdio)
      IT_CMD=$(read_value "Stdio command (e.g. uvx iterable-mcp)")
      IT_KEY=$(read_secret "Iterable API key:")
      if [[ -n "$IT_CMD" && -n "$IT_KEY" ]]; then
        IT_PARTS=($IT_CMD)
        IT_BIN="${IT_PARTS[0]}"
        IT_ARGS=("${IT_PARTS[@]:1}")
        add_server "iterable" "$(jq -n \
          --arg bin "$IT_BIN" \
          --argjson args "$(printf '%s\n' "${IT_ARGS[@]}" | jq -R . | jq -s .)" \
          --arg key "$IT_KEY" \
          '{
            command: $bin,
            args: $args,
            env: { ITERABLE_API_KEY: $key }
          }')"
        ok "Iterable queued (stdio)"
      fi
      ;;
    *) skip "Iterable skipped" ;;
  esac
fi

# ── 4g. Sentry (hosted MCP) ───────────────────────────────────────────

if is_selected sentry; then
  step "Sentry (hosted)"
  add_server "sentry" "$(jq -n '{
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.sentry.dev/sse"]
  }')"
  ok "Sentry queued"
  warn "On first launch Claude Desktop will pop a browser to authorize Sentry."
fi

# ── 5. Merge into claude_desktop_config.json ──────────────────────────

step "Update Claude Desktop config"

CFG_DIR="$HOME/Library/Application Support/Claude"
CFG="$CFG_DIR/claude_desktop_config.json"

if [[ ${#SERVER_KEYS[@]} -eq 0 ]]; then
  warn "No MCPs queued — nothing to write."
else
  if ! $DRY_RUN; then
    mkdir -p "$CFG_DIR"
    if [[ ! -f "$CFG" ]]; then
      echo '{"mcpServers": {}}' > "$CFG"
      ok "Created $CFG"
    else
      BAK="$CFG.bak.$(date +%Y%m%d-%H%M%S)"
      cp "$CFG" "$BAK"
      ok "Backed up existing config → $BAK"
    fi

    # Validate existing JSON before we touch it.
    if ! jq empty "$CFG" 2>/dev/null; then
      err "Existing $CFG is not valid JSON. Fix it manually and re-run."
      exit 1
    fi
  fi

  # Build the diff payload (just the new mcpServers entries) and merge with `*`.
  ADDED_PAYLOAD='{}'
  for i in "${!SERVER_KEYS[@]}"; do
    KEY="${SERVER_KEYS[$i]}"
    ENTRY="${SERVER_JSONS[$i]}"
    ADDED_PAYLOAD=$(jq -n \
      --argjson cur "$ADDED_PAYLOAD" \
      --arg key "$KEY" \
      --argjson entry "$ENTRY" \
      '$cur + {($key): $entry}')
  done

  printf "\n  ${BOLD}MCPs to write:${RESET}\n"
  for k in "${SERVER_KEYS[@]}"; do
    printf "    · %s\n" "$k"
  done

  if $DRY_RUN; then
    echo
    echo "  ${DIM}— dry run; the merged result would be:${RESET}"
    jq -n --argjson add "$ADDED_PAYLOAD" '{mcpServers: $add}'
  else
    # Merge: existing + { mcpServers: existing.mcpServers + added }.
    # The right-hand side wins on key collisions, which is what we want.
    NEW_CFG=$(jq \
      --argjson add "$ADDED_PAYLOAD" \
      '. as $orig | $orig + { mcpServers: ((.mcpServers // {}) + $add) }' \
      "$CFG")
    printf '%s\n' "$NEW_CFG" > "$CFG"
    ok "Wrote $CFG"
  fi
fi

# ── 6. Summary ────────────────────────────────────────────────────────

step "All done"
cat <<EOF

Next steps:

  1. ${BOLD}Quit and reopen Claude Desktop${RESET} — it only reads the config at launch.
  2. ${BOLD}Open a new terminal${RESET} so PATH changes (pipx, brew shellenv) apply.
  3. Verify in Claude: ask "what MCP servers do you have?"

If Sentry was queued, click through the OAuth flow that pops up the
first time Claude Desktop connects to it.

To re-run later (e.g. to add another MCP, or after rotating a token):

  ./scripts/install-mcps.sh

Existing entries you don't re-confirm stay untouched — answer "n" to
the ones you don't want to change.

EOF
