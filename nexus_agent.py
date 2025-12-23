import os
import sys
import subprocess
import webbrowser
import platform
import socket
import pyautogui  # YENİ: Klavye kontrolü için eklendi
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

def get_ip():
    """Bilgisayarın yerel IP adresini döndürür."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

@app.route('/ping', methods=['GET'])
def ping():
    """Uygulamanın bağlantıyı test etmesi için kullanılır."""
    return jsonify({"status": "online", "pc_name": socket.gethostname()}), 200

@app.route('/execute', methods=['POST'])
def execute():
    """Komutları çalıştıran ana endpoint."""
    data = request.json
    if not data:
        return jsonify({"error": "Veri bulunamadı"}), 400

    action_type = data.get('type')
    value = data.get('value') # Örn: 'enter', 'space', 'f', 'esc'
    description = data.get('description', 'İşlem yapılıyor')

    print(f"[NEXUS] İstek Alındı: {action_type} -> {value} ({description})")

    try:
        if action_type == 'OPEN_URL':
            webbrowser.open(value)
            
        elif action_type == 'LAUNCH_APP':
            if platform.system() == "Windows":
                os.startfile(value) if os.path.exists(value) else subprocess.Popen(f"start {value}", shell=True)
            elif platform.system() == "Darwin": # macOS
                subprocess.Popen(["open", "-a", value])
            else: # Linux
                subprocess.Popen([value])

        elif action_type == 'COMMAND':
            subprocess.Popen(value, shell=True)

        elif action_type == 'MACRO':
            print(f"Makro çalıştırılıyor: {value}")
            subprocess.Popen(value, shell=True)

        # --- YENİ EKLENEN KISIM ---
        elif action_type == 'KEYPRESS':
            # Görseldeki talimata uygun olarak tuşa basma eylemi
            # value değeri basılacak tuşu temsil eder (örn: 'k', 'space', 'enter')
            pyautogui.press(value)
        # --------------------------

        return jsonify({"success": True, "message": f"{description} başarıyla çalıştırıldı"}), 200

    except Exception as e:
        print(f"[ERROR] Hata oluştu: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    local_ip = get_ip()
    port = 8080
    
    print("-" * 50)
    print("🚀 NEXUS REMOTE AGENT BAŞLATILDI")
    print(f"📍 Yerel IP Adresiniz: {local_ip}")
    print(f"🔌 Port: {port}")
    print(f"📱 Telefon uygulamasındaki ayarlara bu IP'yi girin.")
    print("-" * 50)
    print("Durdurmak için Ctrl+C tuşlarına basın.")
    
    app.run(host='0.0.0.0', port=port, debug=False)