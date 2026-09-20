# Contributing To Context101

Thanks for taking a look. Context101 is an alpha project, so the most useful contributions are small, well-scoped improvements that make self-hosting safer and easier.

## Good First Areas

- Deployment docs and AWS caveats.
- Connector reliability and clearer error messages.
- Security hardening for trusted-team deployments.
- Tests around brain routing, S3 key handling, connector sync behavior, and MCP tool boundaries.
- UI copy that keeps the alpha status clear without underselling what works.

## Before Opening A PR

1. Keep changes focused. Avoid broad refactors unless they directly support the fix.
2. Document user-facing caveats when behavior is still alpha.
3. Run the relevant checks:

```bash
npm --prefix web run build
npm --prefix cdk run build
cd cdk && npx cdk synth
```

`npm --prefix web run lint` is expected to be clean before release, but the current branch may have existing lint debt while the public-alpha cleanup is in progress.

For CLI changes, also run `npm test -w context101-cli` and bump `version` in `packages/cli/package.json` on the same PR (see below).

## CLI releases (`context101-cli`)

The publishable package name is `context101-cli` (bin `context101`). The public npm package named `context101` is Context7's MCP, not this tool.

On push to `main`, `.github/workflows/publish-cli.yml` runs only when `packages/cli/**` or that workflow file changed:

1. Checkout, Node 20, `npm ci` at the repo root, then `npm test -w context101-cli` (the job fails if tests fail).
2. If git tag `v$VERSION` already exists **or** npm already has that version, publish and release are skipped and the job succeeds. The first run after this workflow lands will see `0.1.1` already on npm and take that path.
3. Otherwise it publishes from `packages/cli` (`npm publish --access public`), pushes an annotated tag `v$VERSION`, and creates a GitHub Release titled `context101-cli $VERSION`.

**When you change the CLI:** bump `version` in `packages/cli/package.json` on the same PR as the code change. Merge to `main` publishes and tags.

**Secret:** set repository secret `NPM_TOKEN` to an npm **automation** token that can publish `context101-cli`. Never commit the token or put it in the workflow YAML.

## Security

Please report suspected security issues privately. See `SECURITY.md`.

## License

By contributing, you agree that your contribution will be licensed under the Elastic License 2.0.
