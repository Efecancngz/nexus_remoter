# pyrefly: ignore [missing-import]
from flask import Flask, request, jsonify
from flask_cors import CORS
import threading
from core.service_interface import Service
from services.ai_service import AiService
import logging
import time
import ipaddress
import os
import sys
from core.cert_store import CertStore
from core.pending_results import PendingResults
from utils.network import get_local_ip

# Suppress Flask logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

class ApiService(Service):
    EXECUTE_TIMEOUT = 15.0  # seconds; must exceed CloseAppAction's 5s wait_procs

    def __init__(self, name, event_bus, security_manager, media_service=None, start_server: bool = True):
        super().__init__(name, event_bus)
        self.security = security_manager
        self.media_service = media_service
        self.last_stats = {"cpu": 0, "ram": 0, "battery": "N/A", "volume": 0}
        self._start_server = start_server

    def on_start(self):
        self.app = Flask(__name__)
        # Allow cross-origin use from the mobile web app while still relying on the
        # session token for authorization. The token lives in the legit app's
        # per-origin storage, so a hostile site cannot read it even with CORS open.
        CORS(self.app)

        cert_dir = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "data", "certs")
        self.cert_path, self.key_path = CertStore(cert_dir).ensure_cert(get_local_ip())

        # Reject requests whose Host header is a domain name (DNS-rebinding
        # attempts). Legitimate clients always connect to the agent by raw LAN IP
        # or localhost, so a hostname there means someone rebound a domain to us.
        self.app.before_request(self._reject_rebinding)

        # Security instance is now injected via __init__

        # Define routes
        self.app.add_url_rule('/ping', 'ping', self.ping, methods=['GET'])
        self.app.add_url_rule('/pair', 'pair', self.pair, methods=['POST'])
        self.app.add_url_rule('/verify', 'verify', self.verify, methods=['GET'])
        self.app.add_url_rule('/execute', 'execute', self.execute, methods=['POST'])
        self.app.add_url_rule('/stats', 'stats', self.get_stats, methods=['GET'])
        self.app.add_url_rule('/', 'cert_landing', self.cert_landing, methods=['GET'])

        # Server-side Gemini proxy (keeps the API key off the client)
        AiService(self.security).register(self.app)

        # Subscribe to stats updates
        self.bus.subscribe("SYSTEM_STATS_UPDATED", self.on_stats_update)

        # Correlate action results back to the blocking /execute request.
        self.pending = PendingResults()
        self.bus.subscribe("ACTION_COMPLETED", self._on_action_completed)
        self.bus.subscribe("ACTION_FAILED", self._on_action_failed)

        self.log = logging.getLogger('werkzeug')
        self.log.setLevel(logging.ERROR)

        if self._start_server:
            # Start proactive polling
            self.start_stats_polling()

            # Run Flask in a separate thread
            self._thread = threading.Thread(target=self._run_server, daemon=True)
            self._thread.start()

    def _reject_rebinding(self):
        host = (request.host or '').split(':')[0].strip()
        if host in ('localhost', ''):
            return None
        try:
            ipaddress.ip_address(host)
        except ValueError:
            logging.warning("[Security] Rejected request with non-IP Host header: %r", host)
            return jsonify({"success": False, "error": "Invalid host"}), 403
        return None

    def _run_server(self):
        self.app.run(host='0.0.0.0', port=8080, debug=False, use_reloader=False, threaded=True, ssl_context=(self.cert_path, self.key_path))

    def on_stop(self):
        pass

    def cert_landing(self):
        return (
            '<html><body style="font-family: sans-serif; text-align: center; padding-top: 40px;">'
            '<h2>Certificate trusted</h2>'
            '<p>You can close this tab and return to the app.</p>'
            '</body></html>'
        )

    def ping(self):
        return jsonify({"status": "ok", "mode": "desktop_agent", "secured": True}), 200

    def pair(self):
        """Verify the pairing PIN and issue a session token."""
        data = request.json
        incoming_pin = data.get('pin')

        if self.security.validate_pin(incoming_pin):
            token = self.security.issue_token()
            return jsonify({"success": True, "message": "Paired successfully", "token": token}), 200
        else:
            return jsonify({"success": False, "message": "Invalid PIN"}), 401

    def _authorized(self):
        return self.security.validate_token(request.headers.get('X-Nexus-Token'))

    def execute(self):
        data = request.json

        # Enforce Security
        if not self._authorized():
             logging.warning("[AuthFail] Rejected /execute request with invalid credentials")
             return jsonify({"success": False, "error": "Unauthorized: Invalid or missing token"}), 401

        action_type = data.get('type', '')
        request_id = data.get('id')
        logging.info("[AuthSuccess] Command accepted: type=%s", action_type)

        # SCHEDULE_ACTION is a scheduler meta-command: scheduling it IS the
        # success; no action result will ever come, so never wait.
        if action_type == 'SCHEDULE_ACTION':
            self.bus.publish("SCHEDULE_ACTION", data)
            return jsonify({"success": True, "status": "queued"}), 200

        # No id -> legacy fire-and-forget; nothing to correlate against.
        if not request_id:
            self.bus.publish("COMMAND_RECEIVED", data)
            return jsonify({"success": True, "status": "queued"}), 200

        # Register BEFORE publishing so the result event (fired later from the
        # action pool thread) cannot be missed.
        self.pending.register(request_id)
        self.bus.publish("COMMAND_RECEIVED", data)
        result = self.pending.wait(request_id, self.EXECUTE_TIMEOUT)
        if result is None:
            return jsonify({"success": False, "error": "Action timed out"}), 200
        return jsonify({"success": result["success"], "error": result.get("error"), "data": result.get("data")}), 200

    def verify(self):
        """Lightweight session-token check for the client's periodic heartbeat."""
        if self._authorized():
            return jsonify({"success": True}), 200
        return jsonify({"success": False}), 401

    def get_stats(self):
        if not self._authorized():
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        return jsonify(self.last_stats), 200

    def on_stats_update(self, event):
        self.last_stats = event.payload
        # Inject volume if media service is available
        if self.media_service:
            self.last_stats['volume'] = self.media_service.get_volume()

    def _on_action_completed(self, event):
        payload = event.payload or {}
        rid = payload.get('id')
        if rid:
            self.pending.resolve(rid, {"success": True, "data": payload.get("data")})

    def _on_action_failed(self, event):
        payload = event.payload or {}
        rid = payload.get('id')
        if rid:
            self.pending.resolve(rid, {"success": False, "error": payload.get('error', 'Action failed')})

    def start_stats_polling(self):
        def poll():
            while True:
                time.sleep(2.0)
                self.bus.publish("GET_SYSTEM_STATS")
        
        t = threading.Thread(target=poll, daemon=True)
        t.start()



