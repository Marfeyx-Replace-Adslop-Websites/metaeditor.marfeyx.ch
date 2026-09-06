# Metaform

A private, browser-based MP3 metadata editor with a dedicated Spotify Local Files preparation workflow.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

The included `.github/workflows/deploy-pages.yml` workflow builds and deploys the `dist` directory whenever `main` is pushed.

In the GitHub repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. Do not select the repository root as the publishing source because Vite source files require a build step.

Metaform reads and writes ID3v2.3 tags entirely in the browser. No file is uploaded to a server. Spotify mode exports a tagged MP3 that can be added through Spotify desktop's **Settings → Library → Local Files** workflow.
