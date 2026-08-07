"""Gradio MCP app for the Reachy Mini Homey Tool Space.

Exposes MCP tools the Reachy conversation app can call:
  - control_home            : control Homey devices by voice
  - get_time_and_weather    : the user's real local time + weather from Homey
  - recall_memory           : what Reachy remembers from earlier conversations
  - remember                : save a note, or an end-of-chat summary, for next time
"""

import gradio as gr

from homey_tools import control_home, get_time_and_weather, recall_memory, remember

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
RECALL_DESCRIPTION = (
    "Recall what you remember about this user from earlier conversations: a short "
    "summary plus recent notes. Call this at the START of a conversation and "
    "whenever the user refers to something from before or asks whether you "
    "remember something. Speak from it naturally — do not read it out verbatim."
)
REMEMBER_DESCRIPTION = (
    "Save something worth remembering for future conversations — the user's name, "
    "preferences, plans, or facts about their home and life. Call this whenever "
    "the user shares something durable, keeping each note to one short sentence. "
    "At the END of a conversation, call it once with kind='digest' and a "
    "one-paragraph summary of what mattered; that replaces the previous summary."
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

    with gr.Row():
        remember_box = gr.Textbox(label="Remember", placeholder="Jeff prefers warm lights at night")
        remember_kind = gr.Dropdown(["note", "digest"], value="note", label="Kind")
        remember_button = gr.Button("Save")
    remember_output = gr.JSON(label="Saved")
    remember_button.click(remember, inputs=[remember_box, remember_kind], outputs=remember_output,
                          api_name=False, queue=False)

    recall_button = gr.Button("Recall memory")
    recall_output = gr.JSON(label="Memory")
    recall_button.click(recall_memory, inputs=None, outputs=recall_output, api_name=False, queue=False)

    # MCP tool endpoints (what the Reachy conversation app calls).
    gr.api(control_home, api_name="control_home", api_description=CONTROL_DESCRIPTION,
           queue=False, concurrency_limit=None)
    gr.api(get_time_and_weather, api_name="get_time_and_weather", api_description=INFO_DESCRIPTION,
           queue=False, concurrency_limit=None)
    gr.api(recall_memory, api_name="recall_memory", api_description=RECALL_DESCRIPTION,
           queue=False, concurrency_limit=None)
    gr.api(remember, api_name="remember", api_description=REMEMBER_DESCRIPTION,
           queue=False, concurrency_limit=None)


if __name__ == "__main__":
    demo.launch(mcp_server=True)
