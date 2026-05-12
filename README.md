<table>
  <tr>
    <td width="240" align="center">
      <img src="assets/icon512.png" width="220" alt="TubeStack Logo">
    </td>
    <td valign="middle">

# TubeStack

### Chrome extension for saving YouTube tabs, organizing playlists, reducing browser RAM usage, and building a long-term AI-assisted video library.

TubeStack is a Chrome Extension (Manifest V3) inspired by OneTab, built specifically for YouTube power users. Instead of leaving dozens of YouTube tabs open consuming RAM and cluttering your browser, TubeStack lets you instantly collapse those tabs into organized local playlists while preserving your place.

TubeStack helps reduce browser resource usage, organize large video queues, build long-term video libraries, and optionally integrate with YouTube and AI services for advanced features.

   </td>
  </tr>
</table>

---

# Features

## OneTab-style YouTube tab saving

- Save all open YouTube tabs into TubeStack playlists
- Close tabs after saving to reduce RAM and browser clutter
- Restore individual videos or entire saved sessions later
- Preserve video URLs and resume positions when possible
- Organize tabs into reusable local playlists stored directly inside the extension

---

# Long-term library system

TubeStack is designed as more than temporary tab storage.

Build a permanent personal YouTube library with:

- **Artists** → YouTube creators/channels
- **Albums** → user-defined topic collections
- **Categories** → organizational groupings
- Custom playlists
- Favorites
- Priority queues
- Watch later lists

Examples:

```txt
Artist: Linus Tech Tips
Album: Homelab Build Ideas
Category: Networking
```

```txt
Artist: Veritasium
Album: Physics Concepts
Category: Education
```

---

# AI-assisted categorization (Optional OpenAI integration)

TubeStack can optionally use the OpenAI API to intelligently organize videos.

AI features include:

- Automatic category generation
- Bulk video categorization
- Topic grouping
- Playlist cleanup
- Smart organization suggestions
- Category depth modes (broad vs detailed organization)

---

## AI categorization modes

### Let AI decide everything
AI automatically creates and assigns categories.

### Use my categories
AI sorts videos into categories you already created.

### Choose category depth
Generate approximately:

- 10 broad categories
- 20 balanced categories
- 30 highly specific categories

---

## How videos are categorized

TubeStack attempts to categorize videos using:

- YouTube metadata
- video titles
- creator/channel names
- descriptions
- tags (when available)

Not all YouTube videos contain useful tags, so AI can supplement missing metadata and improve organization quality.

---

# YouTube API + OAuth features (Optional)

TubeStack works locally without Google integration, but additional features unlock when connecting your own Google Cloud project and YouTube account.

## YouTube Data API v3

Used for:

- playlist imports
- metadata retrieval
- subscription analysis
- channel scanning
- playlist synchronization

## Google OAuth

Used to authenticate actions on your YouTube account.

OAuth unlocks:

- Create YouTube playlists
- Import playlists from your profile
- Export TubeStack playlists to YouTube
- Create playlists as:
  - Public
  - Private
  - Unlisted

TubeStack stores API keys locally on your device using Chrome extension storage.

---

# OpenAI API integration (Optional)

TubeStack can optionally connect to OpenAI for AI-assisted organization features.

OpenAI features include:

- AI categorization
- playlist organization
- smart grouping
- category suggestions
- future recommendation tools

Your OpenAI API key is stored locally on your device and only used when AI features are run.

---

# Focus and resource management tools

TubeStack is designed to help reduce YouTube overload and browser clutter.

Features include:

- Save tabs instead of leaving them open indefinitely
- Reduce RAM usage from large YouTube tab sessions
- Focus sessions
- Queue management
- Prioritization systems
- Watch tracking
- Resume later workflows

Future versions may include:

- screen-time analytics
- session tracking
- recommendation filtering
- creator frequency analysis
- watch habit insights

---

# Installing TubeStack (Developer Mode)

TubeStack is currently installed as an unpacked Chrome Extension.

## Installation steps

1. Download the TubeStack project ZIP or clone/download the repository
2. Extract/unzip the folder somewhere on your computer
3. Open Google Chrome
4. Navigate to:

```txt
chrome://extensions
```

5. Enable **Developer mode** (top-right corner)
6. Click **Load unpacked**
7. Select the TubeStack folder containing:

```txt
manifest.json
```

8. TubeStack should now appear in your Chrome toolbar

---

# TubeStack setup guide

One-time Google Cloud configuration for the YouTube Data API v3 key and OAuth playlist tools, plus optional OpenAI setup for AI categorization.

---

# Google Cloud — one project

TubeStack uses a single Google Cloud project for both:

- YouTube Data API v3
- Google OAuth authentication

Everything can be configured inside Google Cloud Console.

---

## 1. Create or select a Google Cloud project

Create a dedicated project such as:

```txt
TubeStack
```

---

## 2. Enable YouTube Data API v3

Navigate to:

```txt
APIs & Services → Library
```

Search for:

```txt
YouTube Data API v3
```

Then click:

```txt
Enable
```

---

## 3. Create a YouTube API key

Navigate to:

```txt
APIs & Services → Credentials
```

Then:

```txt
Create Credentials → API Key
```

Optional but recommended:

- Restrict the key to YouTube Data API v3 only

Paste the key into:

```txt
TubeStack Settings → YouTube API Key
```

---

## 4. Configure OAuth consent screen

Navigate to:

```txt
APIs & Services → OAuth consent screen
```

Choose:

```txt
External
```

Fill out:

- App name
- Support email
- Developer contact email

Add the scope:

```txt
https://www.googleapis.com/auth/youtube
```

---

## Testing mode recommendation

Keep the OAuth app in:

```txt
Testing
```

Do not publish during development.

Under:

```txt
Test users
```

add the Google email accounts allowed to authenticate with TubeStack.

---

## 5. Create OAuth Client ID

Navigate to:

```txt
APIs & Services → Credentials
→ Create Credentials
→ OAuth Client ID
```

Application type:

```txt
Web application
```

Add the authorized redirect URI shown in TubeStack settings.

Example:

```txt
https://YOUR_EXTENSION_ID.chromiumapp.org/
```

Paste the OAuth Client ID into:

```txt
TubeStack Settings → YouTube OAuth
```

---

# OpenAI setup (Optional)

TubeStack can optionally use OpenAI for AI-powered organization tools.

## 1. Create an OpenAI API key

Visit:

```txt
https://platform.openai.com/
```

Create an API key and paste it into:

```txt
TubeStack Settings → OpenAI API Key
```

---

## Important billing note

ChatGPT subscriptions and OpenAI API billing are separate systems.

Using the OpenAI API requires:
- API billing
- prepaid credits
- or active API payment setup

inside the OpenAI Platform account.

---

# Security

- Do not commit API keys to GitHub
- Do not expose OAuth secrets publicly
- TubeStack stores credentials locally using Chrome extension storage
- Keys entered into settings remain on the local device

---

# Disclaimer

TubeStack is not affiliated with YouTube or Google.

Use YouTube API, OAuth, downloads, and AI integrations responsibly and in accordance with applicable platform terms and laws.

---

# License

MIT — see `LICENSE`
