"""Gradio MCP app for the Reachy Mini Homey Tool Space.

Exposes two MCP tools the Reachy conversation app can call:
  - control_home            : control Homey devices by voice
  - get_time_and_weather    : the user's real local time + weather from Homey
"""

import gradio as gr

from homey_tools import control_home, get_time_and_weather

CONTROL_DESCRIPTION = (
    "Control the user's Homey smart home: turn devices or lights on or off, set "
    "brightness, change light colour or warm/cool white, adjust volume, mute, or "
    "play/pause media. Call this directly whenever the user asks to control "
    "something in their home, passing their request verbatim as the command. "
    "Do not just say you'll do it."
)
INFO_DESCRIPTION = (
    "Get the user's current local time and current weather from their Homey smart "
    "home. Call this directly whenever the user asks what time it is, what the "
    "weather is like, or to announce the time and/or weather. Do not just say "
    "you'll check."
)

with gr.Blocks(title="Reachy Mini Homey Tool") as demo:
    gr.Markdown(
        "# Reachy Mini · Homey Tool\n"
        "Lets Reachy control your **Homey** smart home and read your local **time & weather** by voice.\n\n"
        "**Setup:** in this Space's **Settings → Variables and secrets**, add:\n"
        "- `HOMEY_APP_URL` — from the Homey app's *Voice Control & Weather* setup page\n"
        "- `HOMEY_API_TOKEN` — a Homey API key (my.homey.app → Settings → API Keys)\n\n"
        "Then add this Space to your Reachy conversation app's tools."
    )
    with gr.Row():
        command_box = gr.Textbox(label="Command", placeholder="turn off the living room lights")
        send_button = gr.Button("Send", variant="primary")
    control_output = gr.JSON(label="Result")
    send_button.click(control_home, inputs=command_box, outputs=control_output, api_name=False, queue=False)

    info_button = gr.Button("Get time & weather")
    info_output = gr.JSON(label="Time & weather")
    info_button.click(get_time_and_weather, inputs=None, outputs=info_output, api_name=False, queue=False)

    # MCP tool endpoints (what the Reachy conversation app calls).
    gr.api(control_home, api_name="control_home", api_description=CONTROL_DESCRIPTION,
           queue=False, concurrency_limit=None)
    gr.api(get_time_and_weather, api_name="get_time_and_weather", api_description=INFO_DESCRIPTION,
           queue=False, concurrency_limit=None)


if __name__ == "__main__":
    demo.launch(mcp_server=True)
