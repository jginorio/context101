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

## Security

Please report suspected security issues privately. See `SECURITY.md`.

## License

By contributing, you agree that your contribution will be licensed under the MIT License.
