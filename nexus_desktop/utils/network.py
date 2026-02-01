import socket

def get_local_ip():
    try:
        # This hack connects to a public DNS to find the preferred outgoing IP
        # It doesn't actually establish a connection
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"
