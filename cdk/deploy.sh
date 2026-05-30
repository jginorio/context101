#!/usr/bin/env bash
#
# Context101 — guarded CDK deploy wrapper
#
# Why this exists: the stack has two big optional branches gated on CDK
# context flags. If you run `cdk deploy` without them, CloudFormation
# interprets the missing resources as "the user wants them gone" and
# tears down:
#   · App Runner MCP service           (-c token=<bearer>)
#   · Amplify Hosting + Cognito user
#     pool + wiki-gen Fargate stack    (-c githubToken=<PAT>)
#
# We've shipped that footgun once. This wrapper refuses to invoke cdk
# deploy / diff without the tokens present.
#
# Usage:
#   ./deploy.sh                          # deploy with the two required flags
#   ./deploy.sh --seed                   # also pass -c seed=true (first deploy)
#   ./deploy.sh diff                     # cdk diff with the same context
#   ./deploy.sh synth                    # cdk synth with the same context
#   ./deploy.sh -- <raw-cdk-args>        # passthrough; anything after `--` is
#                                        # forwarded to cdk verbatim
#
# Token source (in order, first non-empty wins):
#   1. environment variable: CTX_TOKEN, CTX_GH_TOKEN
#   2. file: cdk/.deploy-env (sourced as shell; KEY=VAL or `export KEY=...`)
#   3. file: ~/.context101/deploy-env
#   4. GitHub PAT only: `gh auth token` if installed
#
# Override AWS profile via AWS_PROFILE in your env or the env file.
# Optional OpenSaaS env values can also live in the env file:
#   DATABASE_URL, DATABASE_DRIVER, DATABASE_PREPARE,
#   BETTER_AUTH_SECRET, BETTER_AUTH_URL, MCP_TOKEN_PEPPER,
#   APP_MODE, ALLOW_PUBLIC_SIGNUP, BILLING_ENABLED, APP_URL, MARKETING_URL.

set -euo pipefail

cd "$(dirname "$0")"

# ── Output helpers ────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; DIM=''; RESET=''
fi
ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}!${RESET} %s\n" "$*" >&2; }
err()  { printf "${RED}✗${RESET} %s\n" "$*" >&2; }

# ── Parse args ───────────────────────────────────────────────────────
SUBCOMMAND="deploy"
SEED=false
EXTRA_ARGS=()
PASSTHRU=false

while [[ $# -gt 0 ]]; do
  if $PASSTHRU; then
    EXTRA_ARGS+=("$1"); shift; continue
  fi
  case "$1" in
    --seed)   SEED=true; shift ;;
    --)       PASSTHRU=true; shift ;;
    deploy|diff|synth|destroy|ls|bootstrap)
      SUBCOMMAND="$1"; shift ;;
    -*)       EXTRA_ARGS+=("$1"); shift ;;
    *)        EXTRA_ARGS+=("$1"); shift ;;
  esac
done

# ── Load tokens from env file(s) ─────────────────────────────────────
load_env_file() {
  local f="$1"
  if [[ -f "$f" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$f"; set +a
    return 0
  fi
  return 1
}

LOADED_FROM=""
if load_env_file ".deploy-env"; then
  LOADED_FROM=".deploy-env"
elif load_env_file "$HOME/.context101/deploy-env"; then
  LOADED_FROM="~/.context101/deploy-env"
fi

# Allow env vars to take precedence over file values.
TOKEN="${CTX_TOKEN:-}"
GH_TOKEN="${CTX_GH_TOKEN:-}"

# Fall back to gh CLI for the GitHub PAT only.
if [[ -z "$GH_TOKEN" ]] && command -v gh >/dev/null 2>&1; then
  GH_TOKEN=$(gh auth token 2>/dev/null || true)
fi

# ── Guardrail: refuse to run for state-changing subcommands ──────────
needs_guard() {
  case "$SUBCOMMAND" in
    deploy|destroy|diff) return 0 ;;
    *) return 1 ;;
  esac
}

if needs_guard && [[ -z "$TOKEN" || -z "$GH_TOKEN" ]]; then
  err "Missing one or both required tokens for 'cdk $SUBCOMMAND':"
  [[ -z "$TOKEN" ]]    && printf "    · ${BOLD}CTX_TOKEN${RESET}    (the MCP bearer — gates the App Runner service)\n" >&2
  [[ -z "$GH_TOKEN" ]] && printf "    · ${BOLD}CTX_GH_TOKEN${RESET} (the GitHub PAT — gates Amplify Hosting + wiki-gen)\n" >&2
  cat >&2 <<EOF

  ${BOLD}Why this matters:${RESET} the stack's MCP service and Amplify branches
  are gated on CDK context flags. Running cdk deploy without them
  deletes those resources (including the Cognito user pool, your
  teammates' accounts, and the wiki-gen Fargate task).

  ${BOLD}Set them up:${RESET}

    mkdir -p ~/.context101
    cat > ~/.context101/deploy-env <<'ENV'
    # Required
    CTX_TOKEN="context101-platea-2026-bearer"
    # GitHub PAT (or omit this line — the wrapper will fall back to
    # \`gh auth token\` if you have the GitHub CLI logged in).
    # CTX_GH_TOKEN="ghp_..."

    # Optional
    AWS_PROFILE="plateapr.com"
    ENV
    chmod 600 ~/.context101/deploy-env

  Or pop the values into ${BOLD}cdk/.deploy-env${RESET} (gitignored — same
  shape, scoped to this repo). Then re-run:

    ./cdk/deploy.sh${SEED:+ --seed}

EOF
  exit 1
fi

# Tokens that exist as variables (loaded above) get reapplied via the
# context flags. Files are not re-read after this point.

# ── Echo what we're about to run ─────────────────────────────────────
CDK_ARGS=("$SUBCOMMAND")
$SEED && CDK_ARGS+=("-c" "seed=true")
CDK_ARGS+=("-c" "token=$TOKEN")
CDK_ARGS+=("-c" "githubToken=$GH_TOKEN")

add_context_if_set() {
  local key="$1"
  local value="${!key:-}"
  if [[ -n "$value" ]]; then
    CDK_ARGS+=("-c" "$key=$value")
  fi
  return 0
}

add_context_if_set "DATABASE_URL"
add_context_if_set "DATABASE_DRIVER"
add_context_if_set "DATABASE_PREPARE"
add_context_if_set "BETTER_AUTH_SECRET"
add_context_if_set "BETTER_AUTH_URL"
add_context_if_set "MCP_TOKEN_PEPPER"
add_context_if_set "APP_MODE"
add_context_if_set "ALLOW_PUBLIC_SIGNUP"
add_context_if_set "BILLING_ENABLED"
add_context_if_set "APP_URL"
add_context_if_set "MARKETING_URL"

if [[ "$SUBCOMMAND" == "deploy" ]]; then
  CDK_ARGS+=("--require-approval" "never")
fi
# Bash 3.2 + `set -u` trips on an unset array expansion; this guarded
# form expands to nothing when the array is empty.
CDK_ARGS+=(${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"})

# Masked preview — never print real tokens.
mask() { local v="$1"; [[ -z "$v" ]] && echo "(empty)" && return; echo "${v:0:4}…${v: -4}"; }

printf "\n${BOLD}cdk %s${RESET}\n" "$SUBCOMMAND"
[[ -n "$LOADED_FROM" ]] && printf "  ${DIM}env file:    %s${RESET}\n" "$LOADED_FROM"
[[ -n "${AWS_PROFILE:-}" ]] && printf "  ${DIM}AWS_PROFILE: %s${RESET}\n" "$AWS_PROFILE"
printf "  ${DIM}token:       %s${RESET}\n" "$(mask "$TOKEN")"
printf "  ${DIM}githubToken: %s${RESET}\n" "$(mask "$GH_TOKEN")"
[[ -n "${DATABASE_URL:-}" ]]        && printf "  ${DIM}DATABASE_URL:       %s${RESET}\n" "$(mask "$DATABASE_URL")"
[[ -n "${DATABASE_DRIVER:-}" ]]     && printf "  ${DIM}DATABASE_DRIVER:    %s${RESET}\n" "$DATABASE_DRIVER"
[[ -n "${DATABASE_PREPARE:-}" ]]    && printf "  ${DIM}DATABASE_PREPARE:   %s${RESET}\n" "$DATABASE_PREPARE"
[[ -n "${BETTER_AUTH_SECRET:-}" ]]  && printf "  ${DIM}BETTER_AUTH_SECRET: %s${RESET}\n" "$(mask "$BETTER_AUTH_SECRET")"
[[ -n "${BETTER_AUTH_URL:-}" ]]     && printf "  ${DIM}BETTER_AUTH_URL:    %s${RESET}\n" "$BETTER_AUTH_URL"
[[ -n "${MCP_TOKEN_PEPPER:-}" ]]    && printf "  ${DIM}MCP_TOKEN_PEPPER:   %s${RESET}\n" "$(mask "$MCP_TOKEN_PEPPER")"
[[ -n "${APP_MODE:-}" ]]            && printf "  ${DIM}APP_MODE:           %s${RESET}\n" "$APP_MODE"
[[ -n "${ALLOW_PUBLIC_SIGNUP:-}" ]] && printf "  ${DIM}ALLOW_PUBLIC_SIGNUP:%s${RESET}\n" "$ALLOW_PUBLIC_SIGNUP"
[[ -n "${BILLING_ENABLED:-}" ]]     && printf "  ${DIM}BILLING_ENABLED:    %s${RESET}\n" "$BILLING_ENABLED"
[[ -n "${APP_URL:-}" ]]             && printf "  ${DIM}APP_URL:            %s${RESET}\n" "$APP_URL"
[[ -n "${MARKETING_URL:-}" ]]       && printf "  ${DIM}MARKETING_URL:      %s${RESET}\n" "$MARKETING_URL"
$SEED && printf "  ${DIM}seed:        ${RESET}${YELLOW}true${RESET}\n"
printf "\n"

exec npx cdk "${CDK_ARGS[@]}"
