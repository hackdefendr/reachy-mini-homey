"""Homey bridge functions for the Reachy Mini Homey Tool Space.

These call your Homey app's API (the "Reachy Mini Controller" app) so the
conversation AI can control your devices and read your local time + weather.

Configuration (set in this Space's Settings -> Variables and secrets):
  HOMEY_APP_URL    - your Homey app base URL, e.g.
                     https://<homey-id>.connect.athom.com/api/app/co.hf.reachy
                     (copy it from the Homey app's "Voice Control & Weather" setup page)
  HOMEY_API_TOKEN  - a Homey API key (my.homey.app -> Settings -> API Keys)
"""

import json
import os
import urllib.request
from typing import Any, Dict, Optional


def _base_url() -> str:
    return os.environ.get("HOMEY_APP_URL", "").strip().rstrip("/")


def _token() -> str:
    return os.environ.get("HOMEY_API_TOKEN", "").strip()


def _request(path: str, payload: Optional[dict] = None) -> Dict[str, Any]:
    base, token = _base_url(), _token()
    if not base or not token:
        return {
            "status": "error",
            "message": (
                "The Homey connection isn't configured yet. In this Space's "
                "Settings, add HOMEY_APP_URL and HOMEY_API_TOKEN."
            ),
        }
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        base + path,
        data=data,
        method="POST" if payload is not None else "GET",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "message": f"Could not reach Homey: {exc}"}


def control_home(command: str) -> Dict[str, Any]:
    """Control the user's Homey smart home from a spoken request.

    Args:
        command: The home-control request in plain language, e.g.
            "turn off the living room lights" or "make the kitchen blue".

    Returns:
        A short confirmation to say back to the user.
    """
    command = (command or "").strip()
    if not command:
        return {"status": "error", "message": "No command was provided."}
    result = _request("/command", {"command": command})
    message = result.get("message") if isinstance(result, dict) else None
    return {"status": result.get("status", "error"), "message": message or f"Done: {command}"}


def get_time_and_weather() -> Dict[str, Any]:
    """Get the user's current local time and current weather from their Homey.

    Returns:
        A ready-to-say sentence with the real local time and conditions.
    """
    result = _request("/info")
    message = result.get("message") if isinstance(result, dict) else None
    if message:
        return {"status": "success", "message": message}
    return {"status": "error", "message": "I couldn't get the time and weather."}
