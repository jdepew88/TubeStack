<p align="center">
  <img src="assets/8bit logo (512).png" width="220" alt="TubeStack Logo">
</p>

<h1 align="center" style="margin-top: 0;">TubeStack</h1>

<p align="center">
  Chrome extension (Manifest V3) to save YouTube tabs, organize by theme and time,
  run focus sessions, and resume watch progress without losing your place.
</p>

---

## Features

- Save open YouTube tabs into your library from the toolbar
- Dashboard: library, playlists, categories, subscriptions scrape, optional AI categorization (OpenAI)
- Optional **YouTube Data API** and **Google OAuth** for imports / “create on YouTube” flows (keys stay on your device)

## Screenshots

README images live in [`assets/`](./assets/). Add your PNGs or GIFs there, then embed them from this file using paths relative to the repo root, for example:

`![TubeStack dashboard](assets/dashboard.png)`

See [`assets/README.md`](./assets/README.md) for a short note on keeping these separate from extension assets.

## Load unpacked (development)

1. Ensure **`icons/logo.png`** exists (referenced by `manifest.json` and HTML pages). Add a 128×128 PNG if missing.
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select this folder (`tube-stack`, the directory that contains `manifest.json`)

## Publish your own copy on GitHub

Use **`tube-stack`** as the repository root (not a parent IDE or terminals folder), so the first commit contains `manifest.json` at the repo root.

```bash
cd tube-stack
git init
git add .
git commit -m "Initial commit: TubeStack Chrome extension"
```

Create an empty repository on GitHub (no README/license if you already have them here), then:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/tubestack.git
git push -u origin main
```

Or with [GitHub CLI](https://cli.github.com/):

```bash
cd tube-stack
git init && git add . && git commit -m "Initial commit: TubeStack"
gh repo create tubestack --public --source=. --remote=origin --push
```

Replace `tubestack` / URLs with your repo name.

## Security and keys

- **Do not commit** real YouTube API keys, OAuth client secrets, or OpenAI keys. These are stored in extension `chrome.storage.local` after you enter them in Settings.
- Before the first push, search the tree for accidental secrets (e.g. pasted keys in HTML or JS).

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

TubeStack is not affiliated with YouTube or Google. Use the extension and APIs in line with applicable terms and laws.
