"""Custom Reachy conversation tools: remember and recall across conversations.

Give Reachy a small, durable memory that survives reboots and upgrades. The
robot side only decides WHAT is worth remembering and asks for it back; the
storage — and the size limits that keep it small — live in the Homey app,
reached through the same bridge as the other Homey tools.

Two tools:
  recall_memory : fetch what Reachy remembers (a short digest + recent notes)
  remember      : store a fact now, or (kind="digest") save an end-of-chat summary

Configuration (environment variables read by the running app):
  HOMEY_MEMORY_URL - e.g. https://10.71.1.188:4860/api/app/co.hf.reachy/memory
  HOMEY_API_TOKEN  - a Homey API key (Personal Access Token)
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


def _ssl_ctx() -> ssl.SSLContext:
    # Homey's local endpoint uses a self-signed certificate.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


class RecallMemoryTool(Tool):
    """Recall what Reachy remembers from earlier conversations."""

    name = "recall_memory"
    description = (
        "Recall what you remember about this user from earlier conversations: a "
        "short summary plus recent notes. Call this at the START of a conversation "
        "and whenever the user refers to something from before or asks whether you "
        "remember something. Use what it returns to speak naturally — do not read "
        "it out verbatim."
    )
    parameters_schema = {"type": "object", "properties": {}, "required": []}

    async def __call__(self, deps: ToolDependencies, **kwargs: Any) -> Dict[str, Any]:
        url = os.environ.get("HOMEY_MEMORY_URL", "").strip()
        token = os.environ.get("HOMEY_API_TOKEN", "").strip()
        if not url or not token:
            return {"status": "error", "message": "The Homey bridge is not configured."}

        def _get() -> str:
            req = urllib.request.Request(
                url, method="GET", headers={"Authorization": f"Bearer {token}"},
            )
            with urllib.request.urlopen(req, timeout=10, context=_ssl_ctx()) as resp:
                return resp.read().decode("utf-8")

        try:
            data = json.loads(await asyncio.to_thread(_get))
            preamble = (data.get("preamble") or "").strip()
            logger.info(
                "recall_memory -> %d note(s), digest=%s",
                len(data.get("facts") or []), bool(data.get("digest")),
            )
            if not preamble:
                return {"status": "success", "message": "I don't have any earlier notes about this user yet."}
            return {"status": "success", "message": preamble}
        except Exception as exc:  # noqa: BLE001
            logger.error("recall_memory failed: %s", exc)
            return {"status": "error", "message": f"Could not reach Homey: {exc}"}


class RememberTool(Tool):
    """Store something worth remembering for next time."""

    name = "remember"
    description = (
        "Save something worth remembering for future conversations — the user's "
        "name, preferences, plans, or facts about their home and life. Call this "
        "whenever the user shares something durable, keeping each note to one "
        "short sentence. At the END of a conversation, call it once with "
        "kind='digest' and a one-paragraph summary of what mattered; that replaces "
        "the previous summary."
    )
    parameters_schema = {
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "The thing to remember: one short sentence for a "
                "note, or a one-paragraph summary when kind is 'digest'.",
            },
            "kind": {
                "type": "string",
                "enum": ["note", "digest"],
                "description": "'note' for a single fact (default); 'digest' to "
                "replace the running end-of-conversation summary.",
            },
        },
        "required": ["text"],
    }

    async def __call__(self, deps: ToolDependencies, **kwargs: Any) -> Dict[str, Any]:
        text = str(kwargs.get("text", "")).strip()
        kind = str(kwargs.get("kind", "note")).strip() or "note"
        url = os.environ.get("HOMEY_MEMORY_URL", "").strip()
        token = os.environ.get("HOMEY_API_TOKEN", "").strip()

        if not text:
            return {"status": "error", "message": "There was nothing to remember."}
        if not url or not token:
            return {"status": "error", "message": "The Homey bridge is not configured."}

        def _post() -> str:
            data = json.dumps({"text": text, "kind": kind}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {token}",
                },
            )
            with urllib.request.urlopen(req, timeout=10, context=_ssl_ctx()) as resp:
                return resp.read().decode("utf-8")

        try:
            body = await asyncio.to_thread(_post)
            logger.info("remember (%s) '%s' -> %s", kind, text[:60], body)
            return {"status": "success", "message": "Got it — I'll remember that."}
        except Exception as exc:  # noqa: BLE001
            logger.error("remember failed: %s", exc)
            return {"status": "error", "message": f"Could not reach Homey: {exc}"}
