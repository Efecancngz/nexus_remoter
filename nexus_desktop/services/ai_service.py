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

from actions import all_actions
from utils.screen_capture import capture_jpeg_bytes, data_url_from_jpeg_bytes

MODEL_NAME = "gemini-2.5-flash"

_ACTION_TYPES = sorted(all_actions().keys())


def _build_macro_instruction():
    example_lines = []
    hint_lines = []
    for _type, cls in sorted(all_actions().items()):
        example_lines.extend(
            ex.replace("{{", "{").replace("}}", "}") for ex in cls.prompt_examples
        )
        if cls.prompt_hint:
            hint_lines.append(cls.prompt_hint)
    return (
        "Sen NEXUS AI asistanısın.\n"
        "Görevin: Kullanıcı isteğini bilgisayar otomasyon adımlarına çevirmek.\n"
        "Önemli: Sadece saf JSON dizisi döndür. Başka açıklama yapma.\n\n"
        "Örnekler:\n"
        + "\n".join(example_lines)
        + "\n\n"
        + "\n".join(hint_lines)
        + "\n\nKullanılabilir Tipler: " + ", ".join(_ACTION_TYPES)
    )


_MACRO_INSTRUCTION = _build_macro_instruction()

_SCHEDULE_INSTRUCTION = """Sen bir ZAMANLAYICI asistanısın.
Kullanıcı "1 saat sonra kapat" gibi komutlar verecek. Bunu JSON'a çevir.
Çıktı: { "seconds": <number>, "action": { "type": <ActionType>, "value": <str>, "description": <str> } }
Kapatma/yeniden başlatma/uyku/kilitleme için action.type = "SYSTEM_POWER" ve
value = lock|shutdown|restart|sleep kullan. Uygulama açmak için
action.type = "LAUNCH_APP" kullan. Ham shell komutu üretme.
Örnek: "10 dakika sonra kapat" -> { "seconds": 600, "action": { "type": "SYSTEM_POWER", "value": "shutdown", "description": "Sistem kapatılıyor" } }
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


_LOCATE_INSTRUCTION = (
    "Sen bir ekran analiz asistanısın. Sana bir ekran görüntüsü ve tıklanacak "
    "öğenin açıklaması verilecek. Öğenin merkez noktasını bul.\n"
    "Koordinatları 0-1000 aralığında normalize edilmiş tam sayı olarak döndür: "
    "x yatay eksen (soldan sağa), y dikey eksen (yukarıdan aşağıya).\n"
    "Öğeyi bulursan found=true ve x, y ver. Bulamazsan found=false döndür."
)

_LOCATE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "found": {"type": "BOOLEAN"},
        "x": {"type": "INTEGER"},
        "y": {"type": "INTEGER"},
    },
    "required": ["found", "x", "y"],
}


def _clamp_pct(value):
    return max(0.0, min(float(value), 100.0))


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
        app.add_url_rule('/ai/locate', 'ai_locate', self.locate, methods=['POST'])

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

    def locate(self):
        guard = self._guard()
        if guard:
            return guard
        description = (request.json or {}).get('description', '')
        if not description or not description.strip():
            return jsonify({"success": False, "error": "Missing description"}), 400
        try:
            jpeg = capture_jpeg_bytes()
            model = self._model(_LOCATE_INSTRUCTION, _LOCATE_SCHEMA)
            resp = model.generate_content([
                {"mime_type": "image/jpeg", "data": jpeg},
                f"Tıklanacak öğe: {description}",
            ])
            result = json.loads(resp.text)
            if not result.get("found"):
                return jsonify({"success": True, "found": False}), 200
            return jsonify({
                "success": True,
                "found": True,
                "x_pct": _clamp_pct(result["x"] / 10.0),
                "y_pct": _clamp_pct(result["y"] / 10.0),
                "image": data_url_from_jpeg_bytes(jpeg),
            }), 200
        except Exception as e:
            logging.error("[AI] locate error: %s", e)
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
