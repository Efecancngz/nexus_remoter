from flask import Flask, request, jsonify
from flask_cors import CORS
import os, webbrowser, subprocess, time
import platform

# Optional dependencies for enhanced features
try:
    from pycaw.pycaw import AudioUtilities, ISimpleAudioVolume
    from comtypes import CLSCTX_ALL
    import pyautogui
    import psutil
except ImportError:
    print("Warning: Some dependencies (pycaw, comtypes, pyautogui, psutil) are missing. Some features may not work.")

app = Flask(__name__)
CORS(app)

def set_volume(level):
    try:
        sessions = AudioUtilities.GetAudioSessionManager().GetSessionEnumerator()
        # This is a bit complex for global volume, usually we use EndpointVolume
        # Simpler approach using pycaw for Master Volume
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        from ctypes import cast, POINTER
        from comtypes import CLSCTX_ALL
        
        devices = AudioUtilities.GetSpeakers()
        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume = cast(interface, POINTER(IAudioEndpointVolume))
        
        # Level should be 0.0 to 1.0
        val = float(level) / 100.0
        val = max(0.0, min(1.0, val))
        volume.SetMasterVolumeLevelScalar(val, None)
        return True
    except Exception as e:
        print(f"Volume error: {e}")
        return False

def media_control(action):
    try:
        if action == 'PLAY_PAUSE':
            pyautogui.press('playpause')
        elif action == 'NEXT':
            pyautogui.press('nexttrack')
        elif action == 'PREV':
            pyautogui.press('prevtrack')
        elif action == 'MUTE':
            pyautogui.press('volumemute')
        return True
    except Exception as e:
        print(f"Media error: {e}")
        return False

@app.route('/ping', methods=['GET'])
def ping(): return jsonify({"status": "ok", "hostname": platform.node()}), 200


def find_installed_app(search_term):
    search_term = search_term.lower().replace(" ", "")
    
    # Windows Start Menu locations
    paths = [
        os.path.join(os.environ["ProgramData"], r"Microsoft\Windows\Start Menu\Programs"),
        os.path.join(os.environ["APPDATA"], r"Microsoft\Windows\Start Menu\Programs")
    ]
    
    print(f"Searching for app: {search_term}...")
    
    found_candidates = []
    
    for path in paths:
        if not os.path.exists(path): continue
        
        for root, dirs, files in os.walk(path):
            for file in files:
                if file.endswith(".lnk"):
                    # Check if search term is in filename
                    file_name = file.lower().replace(" ", "").replace(".lnk", "")
                    
                    if search_term == file_name:
                        # Exact match functionality
                        return os.path.join(root, file)
                    
                    if search_term in file_name:
                        found_candidates.append(os.path.join(root, file))
    
    # Return best match (shortest filename usually implies exact app name)
    if found_candidates:
        found_candidates.sort(key=lambda x: len(os.path.basename(x)))
        return found_candidates[0]
        
    return None

@app.route('/execute', methods=['POST'])
def execute():
    data = request.json
    action_type = data.get('type')
    value = data.get('value')
    
    print(f"Executing: {action_type} -> {value}")
    
    try:
        if action_type == 'OPEN_URL':
            webbrowser.open(value)
        
        elif action_type == 'COMMAND':
            os.system(value)
        
        elif action_type == 'LAUNCH_APP':
            # 1. Check known protocols first
            lower_val = value.lower().strip()
            
            app_map = {
                'whatsapp': 'start whatsapp:',
                'spotify': 'start spotify:',
                'netflix': 'start netflix:',
                'instagram': 'start instagram:',
                'calculator': 'calc',
                'hesap makinesi': 'calc',
                'notepad': 'notepad',
                'not defteri': 'notepad',
                'paint': 'mspaint',
                'explorer': 'explorer',
                'tarayıcı': 'start chrome',
                'chrome': 'start chrome',
                'edge': 'start msedge'
            }
            
            if lower_val in app_map:
                cmd = app_map[lower_val]
                print(f"Launching known protocol: {cmd}")
                subprocess.Popen(cmd, shell=True)
                return jsonify({"success": True}), 200

            # 2. Try Smart Search in Start Menu
            print("Checking Start Menu...")
            app_path = find_installed_app(lower_val)
            
            if app_path:
                print(f"Found smart shortcut: {app_path}")
                os.startfile(app_path)
                return jsonify({"success": True, "message": f"Launched {os.path.basename(app_path)}"}), 200

            # 3. Fallback to raw command
            print("Using raw fallback...")
            subprocess.Popen(value, shell=True)
            
        elif action_type == 'VOLUME_SET':
            set_volume(value)
            
        elif action_type == 'VOLUME_MUTE':
            media_control('MUTE')
            
        elif action_type == 'MEDIA_PLAY_PAUSE':
            media_control('PLAY_PAUSE')
            
        elif action_type == 'MEDIA_NEXT':
            media_control('NEXT')
            
        elif action_type == 'MEDIA_PREV':
            media_control('PREV')

        elif action_type == 'SYSTEM_POWER':
            if value.lower() == 'shutdown':
                os.system("shutdown /s /t 10")
            elif value.lower() == 'restart':
                os.system("shutdown /r /t 10")
            elif value.lower() == 'sleep':
                os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")

        elif action_type == 'KEYPRESS':
            # Özel tuşlar listesi
            special_keys = [
                'enter', 'tab', 'esc', 'space', 'backspace', 'delete', 
                'up', 'down', 'left', 'right', 'f1', 'f2', 'f3', 'f4', 
                'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12', 
                'win', 'ctrl', 'alt', 'shift', 'capslock'
            ]
            
            val_lower = value.lower()
            
            if val_lower in special_keys:
                pyautogui.press(val_lower)
            else:
                # Normal metin ise harf harf yaz
                pyautogui.write(value, interval=0.05)

        elif action_type == 'WAIT':
            time.sleep(float(value))

        return jsonify({"success": True}), 200
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    # Run on 0.0.0.0 to be accessible from LAN
    app.run(host='0.0.0.0', port=8080)