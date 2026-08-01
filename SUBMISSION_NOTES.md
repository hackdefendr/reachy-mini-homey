# App Store Submission Notes — Reachy Mini Controller

**App ID:** `co.hf.reachy`
**App version:** `1.4.0`
**Permission under review:** `homey:manager:api`

These notes explain, in detail, why this app requests `homey:manager:api`, exactly how it is used,
and the strict limits on that use — so the review team can assess it quickly.

---

## 0. What changed in 1.4.0 (and why this review is unaffected)

Version 1.4.0 adds a **Homey Companion** app for the Reachy Mini robot that makes voice-control
setup **SSH-free**: instead of manually copying Python tools onto the robot over SSH, the user
installs the companion app on the robot and pastes their Homey app URL + API key into its settings
page.

**Nothing about this app's `homey:manager:api` usage changed.** The companion still calls the same
single protected endpoint (`POST /api/app/co.hf.reachy/command`), with the same authenticated
request and the same `{ "command": "..." }` body. The permission scope, the three Web API
operations, the written-capability allow-list, and all safeguards described below are identical to
prior versions. The only Homey-side code change relevant here is a one-line addition to the setup
page's helper (`getSetupInfo()` now also returns the app's base URL for the user to copy), which
uses **no new permission**.

The companion app itself is a separate, open-source project (a Hugging Face Space) that runs on the
robot, not inside this Homey app, and is therefore outside the scope of this permission review.

---

## 1. One-line justification

The app lets a user **control their Homey devices by voice** through a Reachy Mini robot
("Reachy, turn off the living room lights"). To turn a free-form spoken request into a device
action, the app must be able to **enumerate the user's devices/zones and set capability values on
devices that belong to other apps** (Philips Hue lights, a Samsung TV, a Yamaha soundbar, etc.).
That cross-app device control is precisely what `homey:manager:api` provides, and there is no
narrower permission that covers it.

## 2. What the permission is used for (exactly)

The app creates a Web API client once, at startup:

```js
// app.js — onInit()
this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
```

It then uses **only three** Web API operations, and nothing else:

| Operation | Method | Why |
| --- | --- | --- |
| List rooms | `this.api.zones.getZones()` | Match a spoken room name ("kitchen") to a Homey zone |
| List devices | `this.api.devices.getDevices()` | Find the devices the command targets (by class, zone, or name) and read their `capabilities` array to know what actions are possible |
| Set a capability | `this.api.devices.setCapabilityValue({ deviceId, capabilityId, value })` | Perform the requested action |

**Capabilities written** are limited to standard, user-facing control capabilities:
`onoff`, `dim`, `light_mode`, `light_hue`, `light_saturation`, `light_temperature`,
`volume_set`, `volume_up`, `volume_down`, `volume_mute`, `speaker_playing`.

The app **does not** call any other manager (no Flows, users, system, settings, security, zones
mutation, ledger, etc.). It never creates, deletes, or renames devices/zones, and never changes
device or app settings.

## 3. When it runs (the trigger and data flow)

Device control is only ever invoked **in direct response to a user's spoken command**, never on a
timer or in the background. The flow is:

1. The user speaks to the Reachy robot (running the **Homey Companion** app, or the stock
   conversation app with the tools installed).
2. The robot's assistant calls a `control_home` tool, which makes an authenticated HTTP request to
   this app's own API endpoint:
   `POST /api/app/co.hf.reachy/command` with body `{ "command": "<the spoken request>" }`.
   This endpoint is declared in the manifest and is **protected** (not `public`) — it requires a
   valid Homey API key, i.e. only the account owner can reach it.
3. The endpoint handler (`onVoiceCommand`) parses the command, resolves target devices, and sets
   the relevant capability values.
4. It returns a short human-readable confirmation string (e.g. `"Turned off the Kitchen lights
   (7 lights)."`) so the robot can speak it back. No device data beyond this short status is
   returned or transmitted anywhere.

There is also a corresponding **Flow trigger** ("Reachy received a command") so users can build
their own automations, but that path uses the normal Flow system, not `homey:manager:api`.

## 4. Scope limits and safety measures

- **Read scope is minimal:** the app reads only zone names and device name/class/zone/capabilities
  — the metadata needed to match a command. It does not read device history, insights, or sensor
  values.
- **The app excludes its own robot device** from any voice-controlled action (it filters out
  devices whose `driverUri` contains `co.hf.reachy`), so a voice command can never make the robot
  fight itself.
- **Unknown targets are declined, not guessed:** e.g. "turn on the garage lights" when there is no
  "garage" zone returns *"I couldn't find a room called the garage."* rather than acting on all
  devices. This deliberately prevents an ambiguous phrase from switching every light in the house.
- **Unsupported actions fail gracefully** (e.g. "set volume to 40" on a device that only exposes
  step volume returns a spoken explanation, no error).
- **No external transmission of device data.** The Web API is used purely locally to read metadata
  and set capabilities; nothing about the user's devices is sent off-Homey by this app.

## 5. Nothing external is required to review the core app

The `homey:manager:api` usage is entirely self-contained in the Homey app and can be exercised
without the robot: the endpoint `POST /api/app/co.hf.reachy/command` accepts a JSON command and will
control devices and return a confirmation. (The robot-side `control_home` tool — provided by the
optional Homey Companion app — lives on the robot, not in this app.)

### How to reproduce (optional)
With a Homey API key, from any HTTP client on the local network:

```
POST https://<homey-address>/api/app/co.hf.reachy/command
Authorization: Bearer <Homey API key>
Content-Type: application/json

{ "command": "turn on the living room lights" }
```

Response: `{ "status": "ok", "command": "...", "message": "Turned on the Living Room lights (8 lights)." }`

## 6. Code references
- `app.js` — `onInit()` (creates the API client), `onVoiceCommand()` and `controlDevices()`
  (the only code that reads devices/zones and sets capability values).
- `api.js` + `.homeycompose/app.json` `"api"` block — the single protected `command` endpoint.
- `.homeycompose/app.json` `"permissions"` — `homey:manager:geolocation` (for the weather
  announcement) and `homey:manager:api` (for voice device control).

## 7. Summary
`homey:manager:api` is the core enabling permission for the app's headline feature — controlling the
user's whole home by voice. It is used narrowly (list zones, list devices, set a small set of
control capabilities), only in response to an authenticated, user-initiated command, with explicit
safeguards against over-broad or ambiguous actions, and with no external transmission of device
data.
