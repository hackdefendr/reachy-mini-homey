---
title: Reachy Mini Homey Tool
emoji: 🏠
colorFrom: green
colorTo: blue
sdk: gradio
app_file: app.py
pinned: false
short_description: Control your Homey smart home + local time/weather, by voice on Reachy Mini.
tags:
  - reachy-mini-tool
  - mcp
  - homey
---

# Reachy Mini · Homey Tool

An MCP tool Space that lets the [Reachy Mini](https://www.pollen-robotics.com/) conversation app
**control your [Homey](https://homey.app) smart home** and read your **real local time & weather** —
by voice. It pairs with the **Reachy Mini Controller** Homey app.

It exposes two MCP tools:
- **`control_home`** — turn devices/lights on/off, brightness, colour, volume, mute, play/pause.
- **`get_time_and_weather`** — the user's actual local time and current weather (from Homey).

## Setup

1. **Duplicate this Space** to your own Hugging Face account (top-right → *Duplicate this Space*).
2. In the Homey app, open **Reachy Mini Controller → app settings → “Voice Control & Weather — Setup”**,
   create a **Homey API Key**, and copy your **Homey app URL**.
3. In your duplicated Space: **Settings → Variables and secrets**, add:
   - `HOMEY_APP_URL` = your Homey app base URL, e.g.
     `https://<homey-id>.connect.athom.com/api/app/co.hf.reachy`
   - `HOMEY_API_TOKEN` = your Homey API key
4. Add this Space to your Reachy conversation app's tools (see the app's tool-space settings).

Now you can say things like *“Reachy, turn off the living room lights”* or *“what's the weather?”*.

Not affiliated with Pollen Robotics, Hugging Face, or Athom/Homey.
