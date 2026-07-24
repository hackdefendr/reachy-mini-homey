'use strict';

/**
 * App API endpoints, reachable at /api/app/co.hf.reachy/<name>.
 * Called by the Reachy conversation app's tools (with a Homey API key as a
 * Bearer token) to bridge spoken requests to Homey.
 */
module.exports = {
  // Control devices from a spoken command.
  async command({ homey, body }) {
    return homey.app.onVoiceCommand(body || {});
  },
  // Current local time + weather, so the conversation AI can answer/announce it.
  async info({ homey }) {
    return homey.app.getTimeWeather();
  },
  // Homey URLs for the voice-control setup helper (app settings page).
  async setup({ homey }) {
    return homey.app.getSetupInfo();
  },
};
