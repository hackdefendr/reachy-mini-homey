# Changelog

All notable changes to the Reachy Mini Controller app are documented here.
This project adheres to [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

## [1.5.0] — 2026-08-07

Focus: short-term conversation memory, so Reachy can pick up where it left off.

### Added
- **Conversation memory** — in conversation mode Reachy can now remember things across
  conversations (your name, preferences, plans) and recall them later, so it survives a reboot or
  app update and can answer "do you remember…?". Backed by two new conversation tools, `remember`
  and `recall_memory`.
- **`/memory` app API** (GET recall, POST remember, DELETE forget) — stores a small running summary
  plus recent notes in Homey settings, which persist across restarts. The footprint is capped
  automatically (recent-day age-out, a note limit, and a byte budget), so it never grows unbounded.
- **`memoryUrl` in the setup endpoint**, and the Voice Control setup page's SSH note now lists
  `HOMEY_MEMORY_URL`.
- The Homey Companion / tool Space gains `remember` and `recall_memory` MCP tools.

## [1.4.1] — 2026-08-01

### Fixed
- **Head drooping into standby during conversation mode.** While a conversation app (Homey
  Companion or the stock app) is running, the robot could relax its motors during idle silence and
  droop. The device now runs a keep-awake loop that re-asserts motor torque (and lifts the head if it
  had already drooped) — without restarting the app, so it never cuts off the conversation.

## [1.4.0] — 2026-07-31

Focus: SSH-free voice-control setup via the new **Homey Companion** app for Reachy Mini.

### Added
- **Homey Companion integration** — the "Start conversation" action now launches the `homey_companion`
  app on the robot (installable from the Pollen/Hugging Face app store), which bundles the
  `control_home` and `get_time_and_weather` tools and a home-assistant personality. No SSH required.
- **`appUrl` in the setup endpoint** — the settings page now shows a copy-ready Homey app URL to paste
  into the companion.

### Changed
- **Voice Control setup page** rewritten around the companion: copy your Homey app URL + API key and
  paste them into the companion's `/homey` settings page. The previous SSH command method is kept as a
  collapsed "Advanced" option.
- **Start conversation** falls back to the standard conversation app if the companion isn't installed;
  standby self-heal and stop-conversation now recognize either app as conversation mode.

## [1.2.0] — 2026-07-24

Focus: make the app installable and configurable by anyone, not just the original developer.

### Added
- **Manual-IP pairing** — pairing now asks for your own Reachy Mini's address and verifies it
  responds, instead of assuming a hard-coded IP.
- **Voice Control setup page** (app settings) — auto-detects your Homey's URLs, takes your Homey API
  key, and generates a complete copy-paste command to install the voice-control/weather tools on
  your robot (previously an undocumented manual process).
- **Standby self-heal** — if the robot reboots and its face-tracker comes up on a sleeping robot
  (head drooped, motors relaxed), the app detects it within ~30s and wakes + restarts it. Respects
  an intentional "Go to sleep".

### Changed
- Stopping conversation mode now wakes the robot before handing back to the face-tracker, so the
  head can't droop on the hand-off.

## [1.1.0] — 2026-07-24

### Added
- **Conversational time & weather** — Reachy can now answer "what's the weather?" or "announce the
  time and weather" in conversation mode, via a new `get_time_and_weather` tool backed by a Homey
  `/info` API endpoint (Open-Meteo + your location). Previously the conversational AI had no
  weather/time data.
- **OpenAI voice/model pickers** — the OpenAI voice and model are now dropdowns (voices: alloy,
  echo, fable, onyx, nova, shimmer; models: HD `tts-1-hd`, standard `tts-1`, `gpt-4o-mini-tts`).
- A dedicated **ElevenLabs voice ID** field, and a **voice language** dropdown.

### Changed
- **OpenAI is now the default voice provider**, using the **HD** model (`tts-1-hd`) with the *onyx*
  voice for the highest quality out of the box.
- All settings with fixed choices are now **dropdowns** (voice language, OpenAI voice/model).

### Fixed
- **Graceful TTS fallback** — if a key-based provider has no API key or a request fails, Reachy
  now falls back to the free Google voice automatically instead of failing to speak.

## [1.0.0] — 2026-07-23

First release. Turns a Reachy Mini robot into Eyes, Ears, and a Voice for Homey.

### Added
- **Reachy Mini device** with a volume slider and an Awake (wake/sleep) toggle; auto-detects the
  robot and lets you set the address in advanced settings.
- **Voice output** actions: Say a message, Announce the time (12/24-hour), Announce the time and
  weather (Open-Meteo + Homey location), Play a sound file, Set the volume.
- **Selectable TTS provider** — Google Translate (default, no key), OpenAI, or ElevenLabs — with a
  voice name/ID and API key setting. Antennas wiggle while speaking.
- **Eyes** — “A face appeared” trigger via a head-motion proxy (tokens: head yaw/pitch), gated by a
  “Watch for face-tracking motion” setting.
- **Ears** — “Heard someone speak” trigger using the mic array's direction of arrival (tokens:
  direction in degrees and a front/left/right/behind label), gated by a “Listen for sounds” setting.
- **Two-way conversation mode** — Start/Stop actions that switch the robot's on-board conversation
  app in and out; stopping keeps the robot awake (motors hold) instead of drooping into standby.
- **Expressive motion** — Nod, Shake head, Look (left/right/up/down/center), Express an emotion
  (happy/sad/curious/excited/confused), and Look toward the last sound.
- **Voice control of Homey** — a `control_home` conversation tool plus a “Reachy received a command”
  Flow trigger and an app API endpoint. Understands lights (on/off, brightness, colour, warm/cool
  white, colorful scene), TVs/speakers/media (on/off, volume, mute, play/pause), any on/off device,
  and “everything in the &lt;room&gt;”, and speaks a confirmation. Never controls the robot's own
  device, and declines unknown rooms/unsupported actions gracefully.

[1.2.0]: https://github.com/hackdefendr/reachy-mini-homey
[1.1.0]: https://github.com/hackdefendr/reachy-mini-homey
[1.0.0]: https://github.com/hackdefendr/reachy-mini-homey
