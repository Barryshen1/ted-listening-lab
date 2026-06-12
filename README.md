# Talk Listening Lab

A static English-listening practice site for public talks. It supports:

- choosing a talk from a catalog
- playing sentence-length segments
- playback speed control
- per-sentence English and Chinese hide/show controls
- favorites saved in the browser
- importing personal VTT/SRT transcript files
- importing large JSON data packs into IndexedDB
- exportable JSON data format for a larger catalog

## Personal TED Study Data

TED says TED/TEDx content is under Creative Commons BY-NC-ND, requires attribution, must be non-commercial, and cannot be altered. TED also says transcripts/subtitles can be used with the TED Talk video under the same license, but video scraping is not permitted and the TED embeddable player is required for embedded TED videos. For that reason this repo does not bundle a scraped full TED transcript/video archive.

For your own study, keep the generated TED catalog private. The public GitHub Pages site can still use it: open the deployed site, click `Import data`, upload the generated JSON catalog, and the browser stores it locally in IndexedDB.

## Development

```bash
npm install
npm run dev
```

## Import a Talk

```bash
node scripts/import-vtt.mjs \
  --title "Talk title" \
  --speaker "Speaker name" \
  --youtube "YouTube ID or URL" \
  --ted "https://www.ted.com/talks/..." \
  --en ./english.vtt \
  --zh ./chinese.vtt \
  --out ./public/data/my-talk.json
```

The in-app import modal can also add VTT/SRT data to the current browser through IndexedDB.

## Build a Personal TED Catalog

Install `yt-dlp` first:

```bash
brew install yt-dlp
```

Then generate a private data pack from the official TED YouTube channel, a playlist, or a single video:

```bash
npm run build:personal-catalog -- \
  --source https://www.youtube.com/@TED/videos \
  --limit 50 \
  --out ted-personal-catalog.json
```

For a full channel run, omit `--limit`. This can take a long time. The output JSON can be uploaded in the app. If you place it at `public/data/catalog.json` before a local/private build, the app loads it automatically, but that file is ignored by git.

Allow auto-generated captions only when you accept lower accuracy:

```bash
npm run build:personal-catalog -- \
  --source https://www.youtube.com/@TED/videos \
  --auto \
  --out ted-personal-catalog.json
```

## Deployment

This repository deploys to GitHub Pages through `.github/workflows/pages.yml`.
