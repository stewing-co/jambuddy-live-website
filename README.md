# JamBuddy Website

This repository contains the marketing site for **JamBuddy**, a real-time chord detection app. The site is built with [Astro](https://astro.build/) and Tailwind CSS.

JamBuddy is preparing for a closed testing release. Sign up for early access or join the mailing list for updates.

## Closed Testing Signups

Users can now request access to closed testing by submitting the form at
`/closed-testing`. Submissions create GitHub issues using a Netlify serverless
function. Deployments must configure the following environment variables:

```
GITHUB_TOKEN=<personal access token>
GITHUB_REPO=stewing-co/jambuddy-live-website
```

The `GITHUB_TOKEN` secret is stored in Netlify's project environment variables
so deployments do not expose it in code. If you set up your own Netlify project,
generate a token under **Settings → Developer settings → Personal access tokens**
("Tokens (classic)" or a fine-grained token) with at least the `public_repo`
scope and add it as `GITHUB_TOKEN`.

The signup function uses these credentials to open issues in
`stewing-co/jambuddy-live-website` for each signup.

## Local Development

```bash
npm install
npm run dev
```

The local server runs at `localhost:4321`.

## Production Build

To generate the production site, run:

```bash
npm run build
```

The output is written to the `dist/` directory.
