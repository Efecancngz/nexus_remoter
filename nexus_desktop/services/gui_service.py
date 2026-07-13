import tkinter as tk
from tkinter import ttk
import threading
import logging
import psutil
from core.service_interface import Service
from utils.network import get_local_ip

class GuiService(Service):
    def __init__(self, name, event_bus, security_manager):
        super().__init__(name, event_bus)
        self.security = security_manager

    def on_start(self):
        # Run GUI in main thread or separate daemon? 
        # Tkinter usually needs to be in the main thread, but we are in a service structure.
        # We will run it in a separate thread, but keep the window alive (withdraw vs destroy).
        self._thread = threading.Thread(target=self._run_gui_loop, daemon=True)
        self._thread.start()
        
        self.bus.subscribe("SHOW_GUI", self.show_window)
        
    def _run_gui_loop(self):
        try:
            logging.info("GUI Loop Starting")
            
            self.root = tk.Tk()
            self.root.title("Nexus Agent")
            self.root.geometry("300x270")
            self.root.configure(bg="#f0f0f0")
            self.root.resizable(False, False)

            # Center
            screen_width = self.root.winfo_screenwidth()
            screen_height = self.root.winfo_screenheight()
            x = (screen_width // 2) - (300 // 2)
            y = (screen_height // 2) - (270 // 2)
            self.root.geometry(f"300x270+{x}+{y}")
            
            style = ttk.Style()
            style.theme_use('clam')
            
            # ... Components ...
            lbl_title = tk.Label(self.root, text="NEXUS AGENT", font=("Arial Black", 14), fg="#333333", bg="#f0f0f0")
            lbl_title.pack(pady=(20, 5))
            
            lbl_status = tk.Label(self.root, text="● Online", font=("Arial", 10, "bold"), fg="#00aa00", bg="#f0f0f0")
            lbl_status.pack(pady=0)
            
            ip_addr = get_local_ip()
            lbl_ip_title = tk.Label(self.root, text="LOCAL IP:", font=("Arial", 8, "bold"), fg="#666666", bg="#f0f0f0")
            lbl_ip_title.pack(pady=(20, 0))
            
            entry_ip = tk.Entry(self.root, font=("Consolas", 14, "bold"), justify="center", bg="white", fg="black", relief="solid", bd=1)
            entry_ip.insert(0, ip_addr)
            entry_ip.configure(state='readonly')
            entry_ip.pack(pady=5, ipadx=10, ipady=5)
            
            lbl_pin_title = tk.Label(self.root, text="SECURITY PIN:", font=("Arial", 8, "bold"), fg="#666666", bg="#f0f0f0")
            lbl_pin_title.pack(pady=(15, 0))
            
            lbl_pin_val = tk.Label(self.root, text=self.security.pin, font=("Consolas", 18, "bold"), fg="#ff4444", bg="#f0f0f0")
            lbl_pin_val.pack(pady=0)
            
            frame_stats = tk.Frame(self.root, bg="white", bd=1, relief="solid")
            frame_stats.pack(pady=10, ipady=5, ipadx=10)
            
            self.lbl_cpu = tk.Label(frame_stats, text="CPU: --%", font=("Consolas", 10), bg="white", fg="#333", width=12, anchor="w")
            self.lbl_cpu.pack()
            
            self.lbl_ram = tk.Label(frame_stats, text="RAM: --%", font=("Consolas", 10), bg="white", fg="#333", width=12, anchor="w")
            self.lbl_ram.pack()

            self.btn_devices = tk.Button(
                self.root, text="Cihazlar", font=("Arial", 9, "bold"),
                bg="#ffffff", fg="#333333", relief="solid", bd=1,
                command=self._open_devices_window,
            )
            self.btn_devices.pack(pady=(0, 10))

            self.root.protocol("WM_DELETE_WINDOW", self.hide_window)
            
            self.update_stats()
            logging.info("GUI Loop Entering Mainloop")
            self.root.mainloop()
            
        except Exception as e:
            logging.error(f"GUI Crash: {e}", exc_info=True)

    def update_stats(self):
        try:
            if not hasattr(self, 'lbl_cpu'): return
            
            cpu = psutil.cpu_percent(interval=None)
            ram = psutil.virtual_memory().percent
            self.lbl_cpu.config(text=f"CPU: {cpu}%")
            self.lbl_ram.config(text=f"RAM: {ram}%")

            if hasattr(self, 'btn_devices'):
                self.btn_devices.config(text=f"Cihazlar ({len(self.security.list_devices())})")
        except Exception as e:
            logging.warning(f"Failed to update GUI stats: {e}")


        if hasattr(self, 'root') and self.root:
            self.root.after(1000, self.update_stats)

    def _open_devices_window(self):
        from utils.timefmt import format_relative
        if getattr(self, "_dev_win", None) and tk.Toplevel.winfo_exists(self._dev_win):
            self._dev_win.lift()
            return
        win = tk.Toplevel(self.root)
        self._dev_win = win
        win.title("Eşleşmiş Cihazlar")
        win.geometry("340x300")
        win.configure(bg="#f0f0f0")

        self._dev_list_frame = tk.Frame(win, bg="#f0f0f0")
        self._dev_list_frame.pack(fill="both", expand=True, padx=10, pady=10)

        tk.Button(
            win, text="Tümünü Kaldır", font=("Arial", 9, "bold"),
            bg="#ff4444", fg="white", relief="flat",
            command=self._revoke_all_devices,
        ).pack(pady=(0, 10))

        self._render_devices()

    def _render_devices(self):
        from utils.timefmt import format_relative
        frame = getattr(self, "_dev_list_frame", None)
        if not frame or not tk.Frame.winfo_exists(frame):
            return
        for child in frame.winfo_children():
            child.destroy()
        devices = self.security.list_devices()
        if not devices:
            tk.Label(frame, text="Eşleşmiş cihaz yok", bg="#f0f0f0",
                     fg="#666666", font=("Arial", 10)).pack(pady=20)
            return
        for dev in devices:
            row = tk.Frame(frame, bg="#ffffff", bd=1, relief="solid")
            row.pack(fill="x", pady=3)
            info = f"{dev['device_name']}\n{format_relative(dev['last_seen'])}"
            tk.Label(row, text=info, bg="#ffffff", fg="#333333",
                     justify="left", anchor="w", font=("Arial", 9)).pack(
                side="left", padx=8, pady=4)
            tk.Button(
                row, text="Kaldır", font=("Arial", 8, "bold"),
                bg="#ff4444", fg="white", relief="flat",
                command=lambda d=dev["id"]: self._revoke_device(d),
            ).pack(side="right", padx=6, pady=4)

    def _revoke_device(self, device_id):
        self.security.revoke(device_id)
        self._render_devices()

    def _revoke_all_devices(self):
        self.security.revoke_all_tokens()
        self._render_devices()

    def show_window(self, event=None):
        logging.info("Show Window Triggered")
        if hasattr(self, 'root') and self.root:
            try:
                self.root.after(0, self.root.deiconify)
                self.root.after(0, self.root.lift)
                self.root.after(10, lambda: self.root.attributes('-topmost', 1))
                self.root.after(100, lambda: self.root.attributes('-topmost', 0))
            except Exception as e:
                logging.error(f"Show Window Error: {e}")
        else:
            logging.error("Root not found in show_window")

    def hide_window(self):
        self.root.withdraw()

    def on_stop(self):
        if hasattr(self, 'root'):
            self.root.quit()
