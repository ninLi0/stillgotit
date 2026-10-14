"""Local speech recognition. Microphone recordings are removed by the caller."""
import json
import os
import sys
from faster_whisper import WhisperModel

try:
    model = WhisperModel(os.environ.get("WHISPER_MODEL", "base"), device="cpu", compute_type="int8",
                         download_root=os.environ.get("WHISPER_CACHE", ".data/models"))
    segments, info = model.transcribe(sys.argv[1], beam_size=5, vad_filter=True)
    parts = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]
    print(json.dumps({"text": " ".join(s["text"] for s in parts), "segments": parts, "language": info.language}))
except Exception:
    print(json.dumps({"error": "Speech recognition could not finish. Try a shorter recording or type your response."}))
    sys.exit(1)
