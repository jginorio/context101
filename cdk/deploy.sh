#!/usr/bin/env bash
#
# Context101 — compatibility shim.
#
# Why a wrapper existed: MCP (`-c token=`) and Amplify (`-c githubToken=`)
# are optional CDK constructs. A bare `cdk deploy` without those context
# flags tells CloudFormation the resources are gone and deletes them.
# That already happened once.
#
# CDK now fails closed without those flags. The CLI is the front door:
#   context101 deploy
#   npx context101-cli deploy
#
# This script only forwards to the CLI. Do not treat it as the product.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/packages/cli/bin/context101.js"

if [[ ! -f "$CLI" ]]; then
  echo "use \`context101 deploy\`" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  exec node "$CLI" deploy
fi

case "$1" in
  deploy|diff|synth|destroy|list|ls|init|config|help)
    exec node "$CLI" "$@"
    ;;
esac

exec node "$CLI" deploy "$@"
