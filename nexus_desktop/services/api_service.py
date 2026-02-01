from flask import Flask, request, jsonify
from flask_cors import CORS
import threading
from core.service_interface import Service
import logging

# Suppress Flask logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

class ApiService(Service):
    def __init__(self, name, event_bus, security_manager):
        super().__init__(name, event_bus)
        self.security = security_manager

    def on_start(self):
        self.app = Flask(__name__)
        CORS(self.app)
        
        # Security instance is now injected via __init__
        
        # Define routes
        self.app.add_url_rule('/ping', 'ping', self.ping, methods=['GET'])
        self.app.add_url_rule('/pair', 'pair', self.pair, methods=['POST'])
        self.app.add_url_rule('/execute', 'execute', self.execute, methods=['POST'])
        
        self.log = logging.getLogger('werkzeug')
        self.log.setLevel(logging.ERROR)
        
        # Run Flask in a separate thread
        self._thread = threading.Thread(target=self._run_server, daemon=True)
        self._thread.start()

    def _run_server(self):
        self.app.run(host='0.0.0.0', port=8080, debug=False, use_reloader=False)

    def on_stop(self):
        pass

    def ping(self):
        return jsonify({"status": "ok", "mode": "desktop_agent", "secured": True}), 200

    def pair(self):
        """Endpoint to verify PIN and maybe exchange keys in future"""
        data = request.json
        incoming_pin = data.get('pin')
        
        if self.security.validate(incoming_pin):
            return jsonify({"success": True, "message": "Paired successfully"}), 200
        else:
            return jsonify({"success": False, "message": "Invalid PIN"}), 401

    def execute(self):
        data = request.json
        incoming_pin = data.get('pin') or request.headers.get('X-Nexus-PIN')
        
        # Enforce Security
        if not self.security.validate(incoming_pin):
             logging.warning(f"[AuthFail] Expected: '{self.security.pin}' | Received: '{incoming_pin}'")
             return jsonify({"success": False, "error": "Unauthorized: Invalid PIN"}), 401
        
        logging.info(f"[AuthSuccess] Command: {data}")
        
        self.bus.publish("COMMAND_RECEIVED", data)
        
        return jsonify({"success": True, "status": "queued"}), 200
