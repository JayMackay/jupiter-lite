# Getting started

Jupiter Lite is a desktop workspace for working with AI coding agents. Chats are
real Claude Code and Codex sessions; Workspace keeps the cards, reports and files
they produce. Everything is stored as ordinary files in a folder you choose.

## Install

Download the installer for your computer from
[GitHub Releases](https://github.com/JayMackay/jupiter-lite/releases/latest):

| Computer | File |
| --- | --- |
| Windows | `Jupiter-Lite-…-windows-x64-setup.exe` |
| Mac (Apple Silicon) | `Jupiter-Lite-…-macos.dmg` |
| Linux | `Jupiter-Lite-…-x86_64.AppImage` |

On Windows the installer runs for your user only and needs no administrator
rights. If SmartScreen warns about an unknown publisher, choose **More info →
Run anyway**. On a Mac, drag Jupiter to Applications; see the
[macOS notes](../../docs/macos.md) if it asks for confirmation the first time.

## First launch

Jupiter asks where to keep your workspace. **Documents\Jupiter** is suggested;
you can choose any other folder. It is filled with a starter workspace: skills,
knowledge, workflows and these sample cards. Nothing needs to be cloned.

The setup wizard then walks through five steps. You can leave it and come back
with **Back to setup**, or run it again later from **Settings → Run setup again**.

1. **You.** Your name and what Jupiter should call you.
2. **Projects.** The folder that holds your projects. It can be anywhere, such
   as an existing code folder.
3. **Agents.** Git and Node.js, which the tools need, then Claude Code and Codex.
   Missing ones install with one click, and **Sign in** opens the agent so you
   can log in with your own Claude or ChatGPT account.
4. **Tools.** A free starter set installed after one confirmation: working
   methods, document and design skills, a browser for checking UI, current
   library docs and three pixel art tools. Tools you already have are taken over
   so Jupiter can keep them up to date.
5. **Voice.** Optional. Paste an ElevenLabs API key, pick a voice, and Jupiter
   reads its replies aloud.

## Your first chat

In Chats, press **+**, choose Claude Code or Codex, pick a working folder and give
the chat a clear name. Ordinary agent permissions are the default; bypass is a
deliberate per-chat choice.

Try: “Read my project brief and turn it into a small plan. Ask me for anything
that is missing.”

Claude Code can use a Claude Pro or Max login and Codex an eligible ChatGPT
login. Jupiter starts the real installed CLI, so its normal sign-in, limits and
billing apply; no API key is needed for chats.

## Updates

Jupiter checks for new versions when it starts. When one is ready, a banner
offers to install it and restart. Updated skills, workflows and sample cards are
copied into your workspace at the same time. A file you have edited or deleted
is never overwritten.

## Optional keys

Keys live in `.env` in your workspace folder, which stays on your computer.
The Voice step writes the ElevenLabs key for you. Add others only if you use them:

| Key | Used for |
| --- | --- |
| `OPENAI_API_KEY` | The live voice coordinator |
| `FAL_KEY` | Image, video and 3D generation with fal.ai |
| `OPENROUTER_API_KEY` | Cloud dictation (local Whisper is free and the default) |

## Explore the examples

The sample cards show a project hub, a research report and this guide. They are
marked as samples, so they stay visible until you archive them. Archiving changes
the card's status only; its files are kept.

Use Files to look through `projects`, `inbox`, `knowledge`, `processes` and the
skill folders. Markdown opens in Preview; switch to Edit and Save to change it.

## On another computer

Install Jupiter, choose a workspace folder and sign in to your agents again.
Your workspace is plain files: keep it in Git or a synced folder if you want the
same cards and knowledge on both computers. Keys in `.env`, agent logins and chat
histories stay on the computer where they were made.

## Build from source

Only needed if you want to change the app itself. Install Node.js 22.20+, Rust
and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```powershell
git clone https://github.com/JayMackay/jupiter-lite.git
cd jupiter-lite
powershell -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Check
powershell -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Desktop
```

On macOS and Linux, `./setup.sh check` and `./setup.sh desktop` do the same.
`npm run desktop:dev` runs the app from source.
