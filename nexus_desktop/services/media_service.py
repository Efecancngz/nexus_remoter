import logging
import pyautogui
from core.service_interface import Service

# Optional pycaw imports
try:
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    PYCAW_AVAILABLE = True
except ImportError:
    PYCAW_AVAILABLE = False

class MediaService(Service):
    def on_start(self):
        self.bus.subscribe("VOLUME_SET", self.set_volume)
        self.bus.subscribe("VOLUME_MUTE", self.mute_volume)
        self.bus.subscribe("MEDIA_PLAY_PAUSE", lambda e: self.media_key('playpause'))
        self.bus.subscribe("MEDIA_NEXT", lambda e: self.media_key('nexttrack'))
        self.bus.subscribe("MEDIA_PREV", lambda e: self.media_key('prevtrack'))
        
        logging.info(f"MediaService started (Advanced Audio: {PYCAW_AVAILABLE})")

    def on_stop(self):
        pass

    def media_key(self, key):
        logging.info(f"Media Key: {key}")
        pyautogui.press(key)

    def set_volume(self, event):
        if not PYCAW_AVAILABLE:
            logging.warning("pycaw not installed, cannot set specific volume")
            return

        try:
            # Initialize COM for this thread
            import comtypes
            comtypes.CoInitialize()
            
            level = int(event.payload.get('value', 50))
            # Clamp between 0 and 100
            level = max(0, min(100, level))
            
            devices = AudioUtilities.GetSpeakers()
            interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            volume = interface.QueryInterface(IAudioEndpointVolume)
            
            # Scalar volume is 0.0 to 1.0
            scalar = level / 100.0
            volume.SetMasterVolumeLevelScalar(scalar, None)
            logging.info(f"Volume set to {level}%")
            
        except Exception as e:
            logging.error(f"Volume set error: {e}")
        finally:
            try:
                comtypes.CoUninitialize()
            except:
                pass

    def mute_volume(self, event):
        if not PYCAW_AVAILABLE:
            pyautogui.press('volumemute')
            return

        try:
            # Initialize COM for this thread
            import comtypes
            comtypes.CoInitialize()

            devices = AudioUtilities.GetSpeakers()
            interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            volume = interface.QueryInterface(IAudioEndpointVolume)
            
            current = volume.GetMute()
            volume.SetMute(not current, None)
            logging.info(f"Volume mute toggled: {not current}")
            
        except Exception as e:
            logging.error(f"Mute error: {e}")
        finally:
            try:
                import comtypes
            except:
                pass

    def get_volume(self):
        """Returns current master volume level (0-100)."""
        if not PYCAW_AVAILABLE:
            return 0
        try:
            import comtypes
            comtypes.CoInitialize()
            devices = AudioUtilities.GetSpeakers()
            interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            volume = interface.QueryInterface(IAudioEndpointVolume)
            
            # Scalar is 0.0 to 1.0
            scalar = volume.GetMasterVolumeLevelScalar()
            val = int(scalar * 100)
            return val
        except Exception as e:
            logging.error(f"GetVolume error: {e}")
            return 0
        finally:
            try:
                import comtypes
                comtypes.CoUninitialize()
            except:
                pass
