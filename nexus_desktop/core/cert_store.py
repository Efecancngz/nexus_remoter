import datetime
import ipaddress
import logging
import os

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

_VALIDITY_DAYS = 365 * 10


class CertStore:
    """Persists a self-signed TLS cert/key pair for the agent's HTTPS server.

    Not internally thread-safe: callers must serialize access (ApiService
    calls ensure_cert once, synchronously, before starting its server thread).
    """

    def __init__(self, cert_dir):
        self.cert_dir = cert_dir
        self.cert_path = os.path.join(cert_dir, "agent.crt")
        self.key_path = os.path.join(cert_dir, "agent.key")

    def ensure_cert(self, current_ip):
        """Return (cert_path, key_path), generating/regenerating as needed."""
        if not self._is_valid_for(current_ip):
            self._generate(current_ip)
        return self.cert_path, self.key_path

    def _is_valid_for(self, current_ip):
        if not (os.path.exists(self.cert_path) and os.path.exists(self.key_path)):
            return False

        try:
            with open(self.cert_path, "rb") as f:
                cert = x509.load_pem_x509_certificate(f.read())
            with open(self.key_path, "rb") as f:
                serialization.load_pem_private_key(f.read(), password=None)
        except (ValueError, TypeError, OSError) as e:
            logging.warning(f"[CertStore] Failed to parse cert/key in {self.cert_dir}: {e}")
            return False

        now = datetime.datetime.now(datetime.timezone.utc)
        if now >= cert.not_valid_after_utc:
            return False

        try:
            san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
            ips = [str(ip) for ip in san.value.get_values_for_type(x509.IPAddress)]
        except x509.ExtensionNotFound:
            return False

        return current_ip in ips

    def _generate(self, current_ip):
        os.makedirs(self.cert_dir, exist_ok=True)

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, "Nexus Agent"),
        ])

        san_entries = [
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        ]
        try:
            san_entries.append(x509.IPAddress(ipaddress.ip_address(current_ip)))
        except ValueError:
            logging.warning(f"[CertStore] current_ip {current_ip!r} is not a valid IP; omitting from SAN")

        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=_VALIDITY_DAYS))
            .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
            .sign(key, hashes.SHA256())
        )

        with open(self.key_path, "wb") as f:
            f.write(key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            ))

        with open(self.cert_path, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))

        logging.info(f"[CertStore] Generated new self-signed cert for {current_ip} at {self.cert_path}")
