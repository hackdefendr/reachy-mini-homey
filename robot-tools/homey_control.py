"""Custom Reachy conversation tool: control a Homey smart home by voice.

Placed in the conversation app's external_tools/ directory. When the user asks
Reachy to control the house, the LLM calls this tool, which relays the spoken
command to the Homey app's API endpoint. Homey then fires a Flow trigger the
user maps to real device actions.

Configuration (environment variables read by the running app):
  HOMEY_COMMAND_URL - e.g. https://10.71.1.188:4860/api/app/co.hf.reachy/command
  HOMEY_API_TOKEN   - a Homey API key (Personal Access Token)
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


class ControlHomeTool(Tool):
    """Relay a spoken home-control request to Homey."""

    name = "control_home"
    description = (
        "Control the user's Homey smart home: turn devices or lights on or off, "
        "set brightness, activate scenes, or run home automations. Call this "
        "whenever the user asks to control something in their home, passing their "
        "request as the command."
    )
    parameters_schema = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The home-control request in plain language, "
                "e.g. 'turn off the living room lights' or 'activate movie scene'.",
            },
        },
        "required": ["command"],
    }

    async def __call__(self, deps: ToolDependencies, **kwargs: Any) -> Dict[str, Any]:
        command = str(kwargs.get("command", "")).strip()
        url = os.environ.get("HOMEY_COMMAND_URL", "").strip()
        token = os.environ.get("HOMEY_API_TOKEN", "").strip()

        if not command:
            return {"status": "error", "message": "No command was provided."}
        if not url or not token:
            return {"status": "error", "message": "The Homey bridge is not configured."}

        def _post() -> str:
            data = json.dumps({"command": command}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {token}",
                },
            )
            # Homey's local endpoint uses a self-signed certificate.
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                return resp.read().decode("utf-8")

        try:
            body = await asyncio.to_thread(_post)
            logger.info("control_home sent '%s' -> %s", command, body)
            try:
                message = json.loads(body).get("message") or f"Done: {command}"
            except Exception:  # noqa: BLE001
                message = f"Done: {command}"
            return {"status": "success", "message": message}
        except Exception as exc:  # noqa: BLE001
            logger.error("control_home failed: %s", exc)
            return {"status": "error", "message": f"Could not reach Homey: {exc}"}
