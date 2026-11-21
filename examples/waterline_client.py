"""Waterline's free-play AI API. Uses only Python's standard library.

Set WATERLINE_API_KEY and optionally WATERLINE_BASE_URL, then run:
    python examples/waterline_client.py --level intro@1
The example makes one move, explicitly submits it, and prints its rank.
"""
import argparse
import json
import os
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


class WaterlineError(Exception):
    def __init__(self, status, error):
        self.status = status
        self.code = error.get("code", "request_failed")
        super().__init__(error.get("message", str(error)))


class Waterline:
    def __init__(self, api_key, base_url="http://127.0.0.1:4174"):
        self.base = base_url.rstrip("/") + "/api/ai/v1"
        self.api_key = api_key

    def request(self, method, path, data=None):
        body = None if data is None else json.dumps(data).encode("utf-8")
        # Retrying a mutation reuses the same body and request_id.
        for attempt in range(3):
            headers = {"Authorization": "Bearer " + self.api_key}
            if body is not None:
                headers["Content-Type"] = "application/json"
            request = Request(self.base + path, data=body, method=method, headers=headers)
            try:
                with urlopen(request, timeout=40) as response:
                    return json.load(response)
            except HTTPError as error:
                try:
                    payload = json.loads(error.read().decode("utf-8"))
                except (ValueError, UnicodeError):
                    payload = {"error": {"code": "http_error", "message": "HTTP " + str(error.code)}}
                if error.code not in (429, 502, 503, 504) or attempt == 2:
                    raise WaterlineError(error.code, payload.get("error", payload)) from error
                time.sleep(min(10, int(error.headers.get("Retry-After", "2"))))
            except URLError:
                if attempt == 2:
                    raise
                time.sleep(1 + attempt)

    def rules(self):
        return self.request("GET", "/rules")

    def levels(self, source=None, author_id=None, offset=0, limit=25):
        query = {"offset": offset, "limit": limit}
        if source:
            query["source"] = source  # official or workshop
        if author_id:
            query["author_id"] = author_id
        return self.request("GET", "/levels?" + urlencode(query))

    def level(self, level_key):
        return self.request("GET", "/levels/" + quote(level_key, safe=""))

    def start(self, level_key):
        return self.request("POST", "/runs", {
            "level_key": level_key, "request_id": str(uuid.uuid4()),
        })

    def state(self, run_id):
        return self.request("GET", "/runs/" + quote(run_id, safe=""))

    def act(self, run, action):
        return self.request("POST", "/runs/" + run["run_id"] + "/actions", {
            "request_id": str(uuid.uuid4()),
            "expected_revision": run["revision"], "action": action,
        })

    def toggle(self, run, edge_id):
        return self.act(run, {"type": "toggle_edge", "edge_id": edge_id})

    def reset(self, run):
        return self.act(run, {"type": "reset"})

    def submit(self, run):
        return self.request("POST", "/runs/" + run["run_id"] + "/submit", {
            "request_id": str(uuid.uuid4()), "expected_revision": run["revision"],
        })

    def leaderboard(self, level_key, offset=0, limit=25):
        return self.request("GET", "/levels/" + quote(level_key, safe="") +
                            "/leaderboard?" + urlencode({"offset": offset, "limit": limit}))

    def close(self, run_id):
        return self.request("DELETE", "/runs/" + quote(run_id, safe=""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--level", default="intro@1")
    args = parser.parse_args()
    key = os.environ.get("WATERLINE_API_KEY")
    if not key:
        parser.error("Set WATERLINE_API_KEY to a key created in the player account menu")
    client = Waterline(key, os.environ.get("WATERLINE_BASE_URL", "http://127.0.0.1:4174"))
    run = client.start(args.level)
    try:
        print(json.dumps(run, ensure_ascii=False, indent=2))
        # Replace this decision with your model's action selection.
        run = client.toggle(run, run["state"]["edges"][0]["id"])
        result = client.submit(run)
        run = result["run"]
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        client.close(run["run_id"])


if __name__ == "__main__":
    main()
