"""Custom Reachy conversation tool: get the current time and weather from Homey.

The conversation AI has no live weather/time data, so this tool fetches it from
the Homey app's /info endpoint (which uses the home's location + Open-Meteo).

Configuration (environment variables read by the running app):
  HOMEY_INFO_URL  - e.g. https://10.71.1.188:4860/api/app/co.hf.reachy/info
  HOMEY_API_TOKEN - a Homey API key (Personal Access Token)
"""

import asyncio
import json
import logging
import os
import ssl
import urllib.request
from typing import Any, Dict

from reachy_mini_conversation_app.tools.core_tools import Tool, ToolDependencies

logger = logging.getLogger(__name__)


class GetTimeWeatherTool(Tool):
    """Fetch the current local time and weather from Homey."""

    name = "get_time_and_weather"
    description = (
        "Get the user's current local time and current weather from their Homey "
        "smart home. Call this whenever the user asks what time it is, what the "
        "weather is like, or asks you to announce the time and/or weather. It "
        "returns a ready-to-say sentence with the real local time and conditions."
    )
    parameters_schema = {"type": "object", "properties": {}, "required": []}

    async def __call__(self, deps: ToolDependencies, **kwargs: Any) -> Dict[str, Any]:
        url = os.environ.get("HOMEY_INFO_URL", "").strip()
        token = os.environ.get("HOMEY_API_TOKEN", "").strip()
        if not url or not token:
            return {"status": "error", "message": "The Homey bridge is not configured."}

        def _get() -> str:
            req = urllib.request.Request(
                url, method="GET", headers={"Authorization": f"Bearer {token}"},
            )
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                return resp.read().decode("utf-8")

        try:
            body = await asyncio.to_thread(_get)
            data = json.loads(body)
            logger.info("get_time_and_weather -> %s", data.get("message"))
            return {"status": "success", "message": data.get("message") or "I couldn't get the time and weather."}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_time_and_weather failed: %s", exc)
            return {"status": "error", "message": f"Could not reach Homey: {exc}"}
