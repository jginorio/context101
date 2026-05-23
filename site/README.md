# Context101 Site

This is the standalone public website for Context101. It explains the project, points people to the repository, and keeps marketing/docs separate from the deployable app.

Self-hosters do not need to deploy this package. The actual product lives in `../web` and is the only frontend wired into the AWS deployment.

## Development

```bash
npm install
npm run dev
```

## Deployment

Host this separately from the self-hosted app, for example on Amplify Hosting, Vercel, Cloudflare Pages, or any Next.js-compatible static/SSR host.
