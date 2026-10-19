"""shub example plugin, Python 3 standard library only.

Keeps the sidebar section "Hello" filled with the number of running sessions and
logs a line when the user clicks the "Say hello" settings action.
shub starts it with SHUB_URL, SHUB_TOKEN and SHUB_PLUGIN_NAME set and restarts it if it exits.
"""

import json
import os
import time
import urllib.request

URL = os.environ["SHUB_URL"]
TOKEN = os.environ["SHUB_TOKEN"]
NAME = os.environ["SHUB_PLUGIN_NAME"]
SESSION_EVENTS = {"session.started", "session.closed", "session.status", "session.updated"}


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(URL + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        text = res.read()
        return json.loads(text) if text else None


def refresh():
    sessions = call("GET", "/api/sessions")
    running = [s for s in sessions if s["status"] != "exited"]
    entries = [{"id": "count", "title": f"{len(running)} sessions running", "tone": "neutral"}]
    entries += [{"id": s["id"], "title": s["name"], "subtitle": s["status"]} for s in running[:10]]
    call("PUT", f"/api/plugins/{NAME}/sections/hello", {"badge": {"text": str(len(running)), "tone": "neutral"}, "entries": entries})


def events():
    """Yields ServerEvent dicts from the Server-Sent Events stream."""
    req = urllib.request.Request(URL + "/api/events/stream")
    req.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(req) as res:
        for raw in res:
            line = raw.decode().strip()
            if line.startswith("data: "):
                yield json.loads(line[6:])


def main():
    print(f"{NAME} started, talking to {URL}")
    refresh()
    for event in events():
        if event["type"] in SESSION_EVENTS:
            refresh()
        elif event["type"] == "plugin.action" and event["plugin"] == NAME:
            print(f"hello from {NAME}: action {event['actionId']} clicked, context {event['context']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # shub restarts us with backoff; a short pause keeps the log readable
        print(f"error: {err}")
        time.sleep(2)
        raise SystemExit(1)
