# Gemini API Key

MulmoClaude uses Google's Gemini API for image, audio, and video generation. Setting the `GEMINI_API_KEY` environment variable is **technically optional**, but we **strongly recommend** it — a large portion of MulmoClaude's visual and multimedia output depends on it.

A single key unlocks all three capabilities (images, TTS audio, video) — you don't need separate credentials for each.

## What the Key Unlocks

### Images

- **`generateImage`** — creates images from text prompts. The heart of the **Artist** role.
- **`editImages`** — transforms, restyles, or combines up to 8 existing images per call ("convert to Ghibli style", "remove the background", "merge these two photos into one"). Also **Artist**.
- **Inline document images** — roles that produce rich documents (**Guide & Planner**, **Tutor**, Recipe Guide, Trip Planner, …) embed generated images directly into the page via `presentDocument`. Without a key, those image slots fall back to italic "🖼️ Image: &lt;prompt&gt;" text markers — the prompt is preserved, but no picture renders.
- **MulmoScript image beats** — `presentMulmoScript` uses Gemini image models for `imagePrompt` beats. **Storyteller Plus** additionally uses them for consistent-character scenes across a storyboard.

### Audio

- **MulmoScript speech** — `presentMulmoScript` synthesizes speaker voices via Gemini TTS. This is what turns a storyboard into spoken narration, so the **Storyteller** and **Storyteller Plus** roles become near-complete multimedia pieces. Speakers record with whatever the provider's current default is (today `gemini-2.5-flash-preview-tts`) unless the script names a model itself — a speaker can set `"model": "gemini-2.5-pro-preview-tts"` for higher-quality narration at about twice the token price (`config/helps/mulmoscript.md` → speechParams).

### Video

- **MulmoScript movie beats** — beats whose `image.type` is `moviePrompt` are rendered with Google's **Veo** models (`veo-2.0-generate-001`, `veo-3.0-generate-001`, …). Without a key, movie beats can't be produced.

### Bottom line

Without a Gemini API key:

- The **Artist** role has nothing to generate.
- **Storyteller** and **Storyteller Plus** still produce a storyboard, but without images or narration.
- Rich documents from **Guide & Planner**, **Tutor**, and similar roles render as text-only with placeholder markers where images should be.

## How to Get a Key

The Gemini API has a **free tier that is sufficient for personal use**. Higher-volume or premium-model use (e.g. Veo video) may require a paid plan.

1. Open [Google AI Studio → API keys](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key**. If prompted, select or create a Google Cloud project (any project will do).
3. Copy the key — it starts with `AIza…`.
4. Open **Settings → Gemini**, paste the key into the field, and click Save. That is the whole step — it takes effect immediately, with no restart and no file to find.

   The key is written to `~/.mulmoclaude/secrets/GEMINI_API_KEY`, readable only by your user account. It is deliberately outside the `~/mulmoclaude` workspace, which the assistant manages.

### The `.env` route (still supported)

A key in a `.env` file keeps working, and is the right choice for a scripted or CI setup. Add `GEMINI_API_KEY=AIza…` to:

- **Started from the icon** (Finder / desktop shortcut): `~/.env`, in your home directory. An icon has no launch directory — macOS starts apps in `/` — so the app is started from home instead. A shell `export` does **not** work on this route: the launcher takes PATH from your login shell and nothing else, so nothing in `~/.zshrc` reaches the app.
- **Started from a terminal** (`npx mulmoclaude`, or `yarn dev` in a clone): the directory you ran the command in. Here `export GEMINI_API_KEY=…` before launching works too.

Either file needs a restart to be picked up — from the icon, stop the server first via Settings → SERVER → Quit, then click the icon again.

**A key saved in Settings wins** over both the file and the shell. Settings → Gemini says which of the two is in effect, so a value you cannot find is still accounted for.

## Verifying It's Active

Settings → Gemini states whether a key is configured and where it came from. For an end-to-end check, switch to the **Artist** role and ask for _"an image of a red panda"_: if a real image appears in the canvas (instead of an italic text marker or a disabled-role hint), the key is wired up correctly.

You can also inspect the server log on startup: a `GEMINI_API_KEY not set — image / audio / video generation is unavailable` warning means the key was not found. The warning names the exact `.env` path this launch reads, so a key that is set but in the wrong file shows up as a path you did not expect.

## Security

- The key stays on your machine — in `~/.mulmoclaude/secrets/` when saved from Settings, or in your own `.env` file. MulmoClaude never uploads it to its own servers or to Anthropic; requests go directly from your machine to Google.
- Treat the key like a password. Anyone who sees it can make billable API calls against your Google account.
- If you suspect a key has leaked, revoke it from [Google AI Studio → API keys](https://aistudio.google.com/apikey) and generate a new one.
