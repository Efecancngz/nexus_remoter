# pyrefly: ignore [missing-import]
"""Server-side Gemini proxy.

Keeps the Google API key on the PC instead of shipping it in the mobile web
bundle. Registers token-protected /ai/* routes on the agent's Flask app.
"""
import os
import json
import base64
import binascii
import logging
from flask import request, jsonify

try:
    import google.generativeai as genai
except ImportError:
    genai = None
    logging.warning("[AI] google-generativeai not installed; /ai routes disabled")

MODEL_NAME = "gemini-2.5-flash"

_ACTION_TYPES = [
    "LAUNCH_APP", "OPEN_URL", "COMMAND", "MACRO", "WAIT", "KEYPRESS",
    "VOLUME_SET", "VOLUME_MUTE", "MEDIA_PLAY_PAUSE", "MEDIA_NEXT",
    "MEDIA_PREV", "SYSTEM_POWER",
]

_MACRO_INSTRUCTION = f"""Sen NEXUS AI asistanısın.
Görevin: Kullanıcı isteğini bilgisayar otomasyon adımlarına çevirmek.
Önemli: Sadece saf JSON dizisi döndür. Başka açıklama yapma.

Örnekler:
- "Spotify aç": {{ "type": "LAUNCH_APP", "value": "spotify", "description": "Spotify açılıyor" }}
- "Sesi kapat": {{ "type": "VOLUME_MUTE", "value": "true", "description": "Ses kapatılıyor" }}
- "Youtube'u aç": {{ "type": "OPEN_URL", "value": "https://youtube.com", "description": "Youtube açılıyor" }}
- "Bilgisayarı kilitle": {{ "type": "SYSTEM_POWER", "value": "lock", "description": "Bilgisayar kilitleniyor" }}

Ardışık işlemlerde araya mutlaka bekleme (WAIT) koy.
Kullanılabilir Tipler: {", ".join(_ACTION_TYPES)}"""

_SCHEDULE_INSTRUCTION = """Sen bir ZAMANLAYICI asistanısın.
Kullanıcı "1 saat sonra kapat" gibi komutlar verecek. Bunu JSON'a çevir.
Çıktı: { "seconds": <number>, "action": { "type": <ActionType>, "value": <str>, "description": <str> } }
Sadece saf JSON döndür."""

_STEP_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "type": {"type": "STRING", "enum": _ACTION_TYPES},
            "value": {"type": "STRING"},
            "description": {"type": "STRING"},
        },
        "required": ["type", "value", "description"],
    },
}


class AiService:
    """Holds Gemini configuration and the /ai route handlers."""

    def __init__(self, security_manager):
        self.security = security_manager
        self.enabled = False
        api_key = os.getenv("GEMINI_API_KEY")
        if genai and api_key:
            genai.configure(api_key=api_key)
            self.enabled = True
            logging.info("[AI] Gemini proxy enabled")
        else:
            logging.warning("[AI] GEMINI_API_KEY missing or library absent; AI proxy disabled")

    def register(self, app):
        app.add_url_rule('/ai/macro', 'ai_macro', self.macro, methods=['POST'])
        app.add_url_rule('/ai/audio', 'ai_audio', self.audio, methods=['POST'])
        app.add_url_rule('/ai/schedule', 'ai_schedule', self.schedule, methods=['POST'])

    def _authorized(self):
        return self.security.validate_token(request.headers.get('X-Nexus-Token'))

    def _guard(self):
        if not self._authorized():
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        if not self.enabled:
            return jsonify({"success": False, "error": "AI proxy not configured"}), 503
        return None

    def _model(self, instruction, schema):
        config = {"temperature": 0.1, "response_mime_type": "application/json"}
        if schema:
            config["response_schema"] = schema
        return genai.GenerativeModel(
            MODEL_NAME,
            system_instruction=instruction,
            generation_config=config,
        )

    def macro(self):
        guard = self._guard()
        if guard:
            return guard
        prompt = (request.json or {}).get('prompt', '')
        if not prompt:
            return jsonify({"success": False, "error": "Missing prompt"}), 400
        try:
            model = self._model(_MACRO_INSTRUCTION, _STEP_SCHEMA)
            resp = model.generate_content(prompt)
            return jsonify({"success": True, "steps": json.loads(resp.text)}), 200
        except Exception as e:
            logging.error("[AI] macro error: %s", e)
            return jsonify({"success": False, "error": str(e)}), 502

    def audio(self):
        guard = self._guard()
        if guard:
            return guard
        data = request.json or {}
        b64 = data.get('audio')
        mime = data.get('mimeType')
        if not b64 or not mime:
            return jsonify({"success": False, "error": "Missing audio"}), 400
        try:
            audio_bytes = base64.b64decode(b64)
        except (binascii.Error, ValueError):
            return jsonify({"success": False, "error": "Invalid audio encoding"}), 400
        try:
            model = self._model(_MACRO_INSTRUCTION, _STEP_SCHEMA)
            resp = model.generate_content([
                {"mime_type": mime, "data": audio_bytes},
                "Lütfen bu ses kaydını dinle ve komutu otomasyon zincirine dönüştür.",
            ])
            return jsonify({"success": True, "steps": json.loads(resp.text)}), 200
        except Exception as e:
            logging.error("[AI] audio error: %s", e)
            return jsonify({"success": False, "error": str(e)}), 502

    def schedule(self):
        guard = self._guard()
        if guard:
            return guard
        prompt = (request.json or {}).get('prompt', '')
        if not prompt:
            return jsonify({"success": False, "error": "Missing prompt"}), 400
        try:
            model = self._model(_SCHEDULE_INSTRUCTION, None)
            resp = model.generate_content(prompt)
            return jsonify({"success": True, "plan": json.loads(resp.text)}), 200
        except Exception as e:
            logging.error("[AI] schedule error: %s", e)
            return jsonify({"success": False, "error": str(e)}), 502
