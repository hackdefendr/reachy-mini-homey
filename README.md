# Reachy Mini Controller

Give Homey a body. This app turns a [Reachy Mini](https://www.pollen-robotics.com/) robot into
**Eyes, Ears, and a Voice** for your smart home — so Homey can speak, listen, watch, emote, hold a
conversation, and even control your house by voice through the robot.

<p align="center"><img src="assets/images/large.png" width="420" alt="Reachy Mini Controller"></p>

## Features

### 🗣️ Voice
- **Say a message** — Reachy speaks any text (great with Flow tokens).
- **Announce the time** — configurable 12/24-hour format.
- **Announce the time and weather** — cuckoo-clock style, using Homey's location (Open-Meteo).
- **Play a sound** — play an uploaded or built-in sound file.
- **Selectable TTS voice** — **OpenAI** (default, HD `tts-1-hd` model with a voice picker),
  **ElevenLabs**, or **Google Translate** (free). Add an API key for the premium voices; without
  one, Reachy automatically falls back to the free Google voice so it always speaks. Antennas
  wiggle while speaking.

### 👁️ Eyes
- **Trigger: “A face appeared”** — fires when Reachy turns its head to track a face, with the
  head yaw/pitch as tokens. Requires a face-tracking app running on the robot (see *Notes*).

### 👂 Ears
- **Trigger: “Heard someone speak”** — the mic array's direction-of-arrival, firing on each
  speech onset with the **direction** (degrees + front/left/right/behind).

### 💬 Two-way conversation
- **Start / Stop conversation mode** — switch Reachy into the on-robot conversation app for a live
  spoken conversation (HuggingFace realtime backend, no API key). Stopping it keeps Reachy awake
  (motors hold) instead of drooping into standby.
- With the optional Homey tools installed, in conversation you can also ask Reachy for the **current
  time and weather** and have it **control your home** (see below).

### 🎭 Expressive motion
- **Nod / Shake head / Look** (left, right, up, down, center).
- **Express an emotion** — happy, sad, curious, excited, confused.
- **Look toward the last sound** — pairs with the Ears trigger.

### 🏠 Voice control of your home
With the optional `control_home` tool wired into the conversation app, you can say things like
*“Reachy, turn off the living room lights”* or *“make the kitchen blue”* and Reachy will control
your Homey devices and speak a confirmation. Supported out of the box:
- **Lights** — on/off, brightness (`dim`, `%`), colour, warm/cool white, a “colorful” scene, per
  room or all rooms.
- **TVs / speakers / media** — on/off, volume up/down, set volume, mute/unmute, play/pause.
- **Any on/off device**, plus *“everything in the &lt;room&gt;”*.
- **Trigger: “Reachy received a command”** — fires with the spoken command text so you can build
  your own Flows for anything the built-in controller doesn't cover.

### Device
A **Reachy Mini** device with a **volume** slider and an **Awake** (wake/sleep) toggle.

## Requirements
- A **Reachy Mini** on the same network as Homey, with its daemon reachable (default `:8000`).
- **Homey Pro** (the app uses the local Web API to control your devices for voice control).
- Optional: an **OpenAI** or **ElevenLabs** API key for higher-quality speech.
- Optional (Eyes): a face-tracking app installed/running on the robot (e.g. *Reachy Mini Webcam
  Face Tracker*).
- Optional (Voice control): the on-robot **conversation app** plus the `control_home` tool.

## Setup
1. **Add device** → *Reachy Mini Controller* → *Reachy Mini*, and **enter your robot's address**
   (shown on the Reachy dashboard, e.g. `192.168.1.42:8000`). The app verifies it responds.
2. In the device settings choose your **temperature units, clock format, voice provider/voice, and
   API key** (if using OpenAI/ElevenLabs), and enable **“Watch for face-tracking motion”** /
   **“Listen for sounds”** if you want the Eyes / Ears triggers.
3. Build Flows with the cards below. That's everything **except** talking to Reachy to control your
   home / ask the weather, which needs the advanced setup below.

### Voice control & conversational weather (advanced, optional)
Letting you *talk to Reachy* to control your home and ask the weather requires two small Python
tools on the robot itself (the Reachy is a Linux device you reach over SSH). The app makes this
easy: open the app's **settings page → “Reachy Voice Control & Weather — Setup”**, paste a
**Homey API key** (from my.homey.app → API Keys), and it **generates a complete copy-paste command**
you run once on the robot over SSH. It installs the `control_home` and `get_time_and_weather` tools
and points them at this app's API. (A fully SSH-free companion app is planned.)

## Flow cards
**Triggers:** A face appeared · Heard someone speak · Reachy received a command.

**Actions:** Say a message · Announce the time · Announce the time and weather · Play a sound file ·
Set the volume · Wake up · Go to sleep · Start/Stop conversation mode · Nod · Shake head · Look in a
direction · Express an emotion · Look toward the last sound.

## Notes & limitations
- The robot runs **one app at a time**, so the face-tracker Eyes and conversation mode are mutually
  exclusive; the app switches modes for you.
- **Eyes** is a head-motion proxy (the daemon exposes no direct face signal), so it catches faces
  off to the side, not held dead-centre.
- **Ears** needs the daemon to own the mic (no camera app running).
- Some AV devices expose only volume up/down (no absolute volume); the app replies gracefully.

## Credits
Built for the HuggingFace/Pollen **Reachy Mini**. Weather by [Open-Meteo](https://open-meteo.com).
Not affiliated with Pollen Robotics or HuggingFace.
