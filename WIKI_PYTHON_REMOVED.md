# Python wiki-generator removed

The frozen Python tree `wiki-generator/` has been deleted. CDK deploys the
TypeScript image from `wiki-generator-ts/` (`WikiGenImage` in
`cdk/lib/context101-stack.ts`).

Local runs:

```bash
cd wiki-generator-ts
npm install
DOCS_BUCKET=<DocsBucketName> npm run dev
```

See [`wiki-generator-ts/README.md`](./wiki-generator-ts/README.md).
