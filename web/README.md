# Context101 Web App

This is the deployable Context101 admin app. It is intentionally separate from the public marketing site in `../site`.

Self-hosted users deploy this app, not the homepage. The root route redirects into `/knowledge`; the app is gated by Cognito once deployed.

## Local Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Most routes need the AWS environment variables that CDK/Amplify inject in deployed environments. The public landing page is not part of this package anymore.

## Checks

```bash
npm run build
npm run lint
```

## Deployment

`amplify.yml` points Amplify Hosting at this `web` app. The CDK stack injects the environment needed for the admin UI, API routes, connectors, wiki generation, and brain control plane.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
