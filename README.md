# JamBuddy Website

This repository contains the marketing site for **JamBuddy**, a real-time chord detection app. The site is built with [Astro](https://astro.build/) and Tailwind CSS.

JamBuddy is preparing for a closed alpha testing release. Sign up for early access or join the mailing list for updates.

## Closed Alpha Testing Signups

Users can now request access to closed alpha testing by submitting the form at
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

## Closed Alpha Testing Signups

Users can now request access to closed alpha testing by submitting the form at
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

## Alpha Tester Google Group

Join our Google Group to discuss testing and receive updates:

- Email: [jambuddy-testers@googlegroups.com](mailto:jambuddy-testers@googlegroups.com)
- Direct link: <https://play.google.com/apps/testing/com.jambuddy.app>

After joining the test group you can download the app from the Google Play Store:
<https://play.google.com/store/apps/details?id=com.jambuddy.app>
