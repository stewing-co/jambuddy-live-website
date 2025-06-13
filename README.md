# JamBuddy Website

This repository contains the marketing site for **JamBuddy**, a real-time chord detection app. The site is built with [Astro](https://astro.build/) and Tailwind CSS.

JamBuddy is currently available via open testing on Google Play. Visit the site to join the program and give feedback as development continues.

## Closed Testing Signups

Users can now request access to closed testing by submitting the form at
`/closed-testing`. Submissions create GitHub issues using a Netlify serverless
function. Deployments must configure the following environment variables:

```
GITHUB_TOKEN=<personal access token>
GITHUB_REPO=stewing-co/jambuddy-live-website
```

Create a token under **Settings → Developer settings → Personal access tokens**
("Tokens (classic)" or a fine-grained token) with at least the `public_repo`
scope. Add this token to your Netlify project as `GITHUB_TOKEN` so the signup
function can open issues on your behalf.

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
