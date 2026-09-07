# Metaform

A private, browser-based file metadata organizer with a dedicated MP3/Spotify Local Files preparation workflow.

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

File Metadata mode accepts any file type and exports the untouched file together with a portable JSON metadata sidecar. Spotify mode reads and writes ID3v2.3 tags directly inside MP3 files. All processing happens in the browser and nothing is uploaded to a server.
