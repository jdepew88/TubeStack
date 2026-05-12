#!/usr/bin/env python3
"""
TubeStack native messaging host: runs yt-dlp embedded (YoutubeDL) for local downloads.

Requires: pip install yt-dlp
Optional: FFmpeg on PATH (merge + audio extract).

Chrome sends one JSON object per message:
  { "action": "download", "preset": "mp4"|"mkv"|"m4a"|"mp3"|"opus", "urls": ["https://..."] }

Responds with one JSON object:
  { "ok": true, "output_folder": "...", "results": [ { "url", "ok", "error?" } ] }
"""

from __future__ import annotations

import copy
import json
import struct
import sys
from pathlib import Path
from typing import Any, Optional


def read_message() -> Optional[dict[str, Any]]:
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    msg_len = struct.unpack("@I", raw_len)[0]
    if msg_len > 64 * 1024 * 1024:
        return {"_parse_error": "message too large"}
    data = sys.stdin.buffer.read(msg_len)
    if len(data) < msg_len:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except json.JSONDecodeError as e:
        return {"_parse_error": str(e)}


def send_message(obj: dict) -> None:
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def output_dir() -> Path:
    d = Path.home() / "Downloads" / "TubeStack"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ydl_opts(preset: str, folder: Path) -> dict:
    tmpl = str(folder / "%(title)s [%(id)s].%(ext)s")
    base: dict = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "outtmpl": tmpl,
        "retries": 3,
        "fragment_retries": 3,
    }
    if preset == "mp4":
        return {
            **base,
            "format": "bv*+ba/bestvideo+bestaudio/best",
            "merge_output_format": "mp4",
        }
    if preset == "mkv":
        return {
            **base,
            "format": "bv*+ba/bestvideo+bestaudio/best",
            "merge_output_format": "mkv",
        }
    if preset in ("m4a", "mp3", "opus"):
        codec = {"m4a": "m4a", "mp3": "mp3", "opus": "opus"}[preset]
        return {
            **base,
            "format": "bestaudio/best",
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": codec,
                    "preferredquality": "0",
                }
            ],
        }
    return {**base, "format": "bv*+ba/bestvideo+bestaudio/best", "merge_output_format": "mp4"}


def main() -> None:
    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        send_message(
            {
                "ok": False,
                "error": "missing_ytdlp",
                "message": "Python module yt_dlp not found. Install with: pip install yt-dlp",
            }
        )
        return

    msg = read_message()
    if msg is None:
        send_message({"ok": False, "error": "no_input", "message": "No message from Chrome."})
        return
    if isinstance(msg, dict) and msg.get("_parse_error"):
        send_message({"ok": False, "error": "parse", "message": msg["_parse_error"]})
        return

    action = msg.get("action")
    preset = str(msg.get("preset") or "mp4").lower()
    urls = [u for u in (msg.get("urls") or []) if isinstance(u, str) and u.strip()]
    if action != "download" or not urls:
        send_message({"ok": False, "error": "bad_request", "message": "Expected action=download and non-empty urls."})
        return

    if preset not in ("mp4", "mkv", "m4a", "mp3", "opus"):
        preset = "mp4"

    folder = output_dir()
    opts = ydl_opts(preset, folder)
    results: list[dict] = []

    for url in urls[:50]:
        try:
            with YoutubeDL(copy.deepcopy(opts)) as ydl:
                ydl.download([url])
            results.append({"url": url, "ok": True})
        except Exception as e:  # noqa: BLE001
            results.append({"url": url, "ok": False, "error": str(e)})

    send_message(
        {
            "ok": True,
            "preset": preset,
            "output_folder": str(folder),
            "results": results,
        }
    )


if __name__ == "__main__":
    main()
