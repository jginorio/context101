#!/usr/bin/env bash
#
# Context101 — guarded CDK deploy wrapper
#
# Why this exists: the stack has two big optional branches gated on CDK
# context flags. If you run `cdk deploy` without them, CloudFormation
# interprets the missing resources as "the user wants them gone" and
# tears down:
#   · App Runner MCP service           (-c token=<bearer>)
#   · Amplify Hosting + wiki-gen
#     Fargate stack                    (-c githubToken=<PAT>)
#
# We've shipped that footgun once. This wrapper refuses to invoke cdk
# deploy / diff without the tokens present.
#
# Usage:
#   ./deploy.sh                          # deploy with CTX_TOKEN (Amplify PAT only if REPOSITORY is set)
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
#   APP_MODE, ALLOW_PUBLIC_SIGNUP, BILLING_ENABLED, APP_URL, MARKETING_URL,
#   MCP_PUBLIC_HOST, MCP_DOMAIN_CERT_ARN, MCP_APPRUNNER,
#   SES_REGION, SES_FROM_EMAIL, SES_REPLY_TO_EMAIL,
#   REPOSITORY, EMBED_MODEL_ID, CREATE_RDS.
#
# MCP compute (see "Migrating off App Runner" in the README):
#   MCP_DOMAIN_CERT_ARN — issued us-east-1 ACM cert ARN for the MCP custom
#     domain; attaches MCP_PUBLIC_HOST to the CloudFront distribution.
#   MCP_APPRUNNER=false — removes the legacy App Runner service after DNS
#     has been cut over to CloudFront.

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

# Allow env vars to take precedence over file values for the two tokens.
TOKEN="${CTX_TOKEN:-}"
GH_TOKEN="${CTX_GH_TOKEN:-}"

# Fall back to gh CLI for the GitHub PAT only.
if [[ -z "$GH_TOKEN" ]] && command -v gh >/dev/null 2>&1; then
  GH_TOKEN=$(gh auth token 2>/dev/null || true)
fi

# Amplify CreateApp calls GitHub list-repository-webhooks with this
# token. Installation tokens (ghs_) and gh OAuth tokens (gho_) return
# 403 and CloudFormation rolls the whole stack back.
github_token_works_for_amplify() {
  local t="$1"
  [[ "$t" == ghp_* || "$t" == github_pat_* ]]
}

# ── Guardrail: refuse to run for state-changing subcommands ──────────
needs_guard() {
  case "$SUBCOMMAND" in
    deploy|destroy|diff) return 0 ;;
    *) return 1 ;;
  esac
}

REPO="${REPOSITORY:-}"
AMPLIFY=false
if [[ -n "$REPO" ]]; then
  AMPLIFY=true
fi

if needs_guard && $AMPLIFY && ! github_token_works_for_amplify "$GH_TOKEN"; then
  err "GitHub token is not a personal access token (need ghp_ or github_pat_)."
  err "Amplify CreateApp calls list-repository-webhooks; ghs_ / gho_ tokens 403 and roll the stack back."
  err "Set CTX_GH_TOKEN to a classic PAT with repo scope (webhook + contents)."
  exit 1
fi

if needs_guard && [[ -z "$TOKEN" ]]; then
  err "Missing CTX_TOKEN for 'cdk $SUBCOMMAND':"
  printf "    · ${BOLD}CTX_TOKEN${RESET}    (the MCP bearer — gates the App Runner service)\n" >&2
  cat >&2 <<EOF

  ${BOLD}Why this matters:${RESET} the stack's MCP service is gated on a CDK
  context flag. Running cdk deploy without CTX_TOKEN deletes it.

  Amplify Hosting is optional. Set REPOSITORY and a GitHub PAT
  (CTX_GH_TOKEN=ghp_…) only when you want the wrapper to watch a repo.

  ${BOLD}Set them up:${RESET}

    mkdir -p ~/.context101
    cat > ~/.context101/deploy-env <<'ENV'
    # Required
    CTX_TOKEN="context101-platea-2026-bearer"
    # Optional — only if Amplify should watch a GitHub repo
    # REPOSITORY="https://github.com/<you>/context101"
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
if $AMPLIFY; then
  CDK_ARGS+=("-c" "githubToken=$GH_TOKEN")
fi

# When an env file was loaded, only forward keys declared in that file.
# Ambient hosted vars (BETTER_AUTH_URL, APP_URL, MCP_PUBLIC_HOST, …)
# must not become CDK context on a self-host deploy.
env_file_declares() {
  local key="$1"
  local f="$2"
  [[ -n "$f" && -f "$f" ]] || return 1
  grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$f"
}

# Hosted product zone — self-host uses an operator domain or Amplify default.
is_hosted_context101_url() {
  local raw="${1:-}"
  [[ -z "$raw" ]] && return 1
  local host
  host=$(printf '%s' "$raw" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##' | cut -d/ -f1 | cut -d: -f1 | tr '[:upper:]' '[:lower:]')
  [[ "$host" == "context101.dev" || "$host" == *.context101.dev ]]
}

LOADED_FROM_PATH=""
if [[ "$LOADED_FROM" == ".deploy-env" ]]; then
  LOADED_FROM_PATH=".deploy-env"
elif [[ "$LOADED_FROM" == "~/.context101/deploy-env" ]]; then
  LOADED_FROM_PATH="$HOME/.context101/deploy-env"
fi

add_context_if_set() {
  local key="$1"
  if [[ -n "$LOADED_FROM_PATH" ]] && ! env_file_declares "$key" "$LOADED_FROM_PATH"; then
    return 0
  fi
  local value="${!key:-}"
  if is_hosted_context101_url "$value"; then
    if [[ -n "$LOADED_FROM_PATH" ]] && env_file_declares "$key" "$LOADED_FROM_PATH"; then
      err "$key in $LOADED_FROM is the hosted Context101 product, not a self-host URL."
      err "Omit it so CDK uses the Amplify default domain, or set a domain you own."
      exit 1
    fi
    return 0
  fi
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
add_context_if_set "MCP_PUBLIC_HOST"
add_context_if_set "MCP_DOMAIN_CERT_ARN"
add_context_if_set "MCP_APPRUNNER"
add_context_if_set "SES_REGION"
add_context_if_set "SES_FROM_EMAIL"
add_context_if_set "SES_REPLY_TO_EMAIL"
add_context_if_set "REPOSITORY"
add_context_if_set "EMBED_MODEL_ID"
add_context_if_set "CREATE_RDS"

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
if $AMPLIFY; then
  printf "  ${DIM}githubToken: %s${RESET}\n" "$(mask "$GH_TOKEN")"
else
  printf "  ${DIM}githubToken: (skipped — no REPOSITORY)${RESET}\n"
fi

preview_if_forwarded() {
  local key="$1"
  local label="$2"
  if [[ -n "$LOADED_FROM_PATH" ]] && ! env_file_declares "$key" "$LOADED_FROM_PATH"; then
    return 0
  fi
  local raw="${!key:-}"
  [[ -n "$raw" ]] && printf "  ${DIM}%s${RESET}\n" "$label"
}

preview_if_forwarded "DATABASE_URL"        "DATABASE_URL:       $(mask "${DATABASE_URL:-}")"
preview_if_forwarded "DATABASE_DRIVER"     "DATABASE_DRIVER:    ${DATABASE_DRIVER:-}"
preview_if_forwarded "DATABASE_PREPARE"    "DATABASE_PREPARE:   ${DATABASE_PREPARE:-}"
preview_if_forwarded "BETTER_AUTH_SECRET"  "BETTER_AUTH_SECRET: $(mask "${BETTER_AUTH_SECRET:-}")"
preview_if_forwarded "BETTER_AUTH_URL"     "BETTER_AUTH_URL:    ${BETTER_AUTH_URL:-}"
preview_if_forwarded "MCP_TOKEN_PEPPER"    "MCP_TOKEN_PEPPER:   $(mask "${MCP_TOKEN_PEPPER:-}")"
preview_if_forwarded "APP_MODE"            "APP_MODE:           ${APP_MODE:-}"
preview_if_forwarded "ALLOW_PUBLIC_SIGNUP" "ALLOW_PUBLIC_SIGNUP:${ALLOW_PUBLIC_SIGNUP:-}"
preview_if_forwarded "BILLING_ENABLED"     "BILLING_ENABLED:    ${BILLING_ENABLED:-}"
preview_if_forwarded "APP_URL"             "APP_URL:            ${APP_URL:-}"
preview_if_forwarded "MARKETING_URL"       "MARKETING_URL:      ${MARKETING_URL:-}"
preview_if_forwarded "REPOSITORY"          "REPOSITORY:         ${REPOSITORY:-}"
preview_if_forwarded "EMBED_MODEL_ID"      "EMBED_MODEL_ID:     ${EMBED_MODEL_ID:-}"
preview_if_forwarded "CREATE_RDS"          "CREATE_RDS:         ${CREATE_RDS:-}"
$SEED && printf "  ${DIM}seed:        ${RESET}${YELLOW}true${RESET}\n"
printf "\n"

exec npx cdk "${CDK_ARGS[@]}"
