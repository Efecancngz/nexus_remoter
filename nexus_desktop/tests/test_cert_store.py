import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import datetime
import ipaddress

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from core.cert_store import CertStore


def _load_cert(path):
    with open(path, "rb") as f:
        return x509.load_pem_x509_certificate(f.read())


def _san_ips(cert):
    ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
    return [str(ip) for ip in ext.value.get_values_for_type(x509.IPAddress)]


def _san_dns_names(cert):
    ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
    return ext.value.get_values_for_type(x509.DNSName)


def test_generates_cert_and_key_when_missing(tmp_path):
    store = CertStore(str(tmp_path))

    cert_path, key_path = store.ensure_cert("192.168.1.5")

    assert os.path.exists(cert_path)
    assert os.path.exists(key_path)
    cert = _load_cert(cert_path)
    assert "192.168.1.5" in _san_ips(cert)
    assert "127.0.0.1" in _san_ips(cert)
    assert "localhost" in _san_dns_names(cert)


def test_key_file_is_a_valid_private_key(tmp_path):
    store = CertStore(str(tmp_path))
    _, key_path = store.ensure_cert("192.168.1.5")

    with open(key_path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)

    assert key.key_size == 2048


def test_reuses_existing_valid_cert(tmp_path):
    store = CertStore(str(tmp_path))
    cert_path, key_path = store.ensure_cert("192.168.1.5")
    first_bytes = open(cert_path, "rb").read()

    cert_path2, key_path2 = store.ensure_cert("192.168.1.5")

    assert cert_path == cert_path2
    assert open(cert_path2, "rb").read() == first_bytes


def test_regenerates_when_ip_not_in_existing_san(tmp_path):
    store = CertStore(str(tmp_path))
    cert_path, _ = store.ensure_cert("192.168.1.5")
    first_bytes = open(cert_path, "rb").read()

    store.ensure_cert("10.0.0.9")

    assert open(cert_path, "rb").read() != first_bytes
    cert = _load_cert(cert_path)
    assert "10.0.0.9" in _san_ips(cert)


def test_regenerates_when_cert_file_is_corrupt(tmp_path):
    store = CertStore(str(tmp_path))
    cert_path, key_path = store.ensure_cert("192.168.1.5")

    with open(cert_path, "wb") as f:
        f.write(b"not a real certificate")

    new_cert_path, new_key_path = store.ensure_cert("192.168.1.5")

    assert new_cert_path == cert_path
    cert = _load_cert(new_cert_path)
    assert "192.168.1.5" in _san_ips(cert)


def test_regenerates_when_cert_is_expired(tmp_path):
    store = CertStore(str(tmp_path))
    os.makedirs(str(tmp_path), exist_ok=True)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([])
    now = datetime.datetime.now(datetime.timezone.utc)
    expired_cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=30))
        .not_valid_after(now - datetime.timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.IPAddress(ipaddress.ip_address("192.168.1.5")),
                x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                x509.DNSName("localhost"),
            ]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    with open(store.cert_path, "wb") as f:
        f.write(expired_cert.public_bytes(serialization.Encoding.PEM))
    with open(store.key_path, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ))

    store.ensure_cert("192.168.1.5")

    cert = _load_cert(store.cert_path)
    assert cert.not_valid_after_utc > now


def test_regenerates_when_key_file_is_missing(tmp_path):
    store = CertStore(str(tmp_path))
    cert_path, key_path = store.ensure_cert("192.168.1.5")
    os.remove(key_path)

    store.ensure_cert("192.168.1.5")

    assert os.path.exists(key_path)


def test_regenerates_when_key_file_is_encrypted(tmp_path):
    store = CertStore(str(tmp_path))
    cert_path, key_path = store.ensure_cert("192.168.1.5")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    encrypted_key_bytes = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.BestAvailableEncryption(b"some-password"),
    )
    with open(key_path, "wb") as f:
        f.write(encrypted_key_bytes)

    # Must not raise, and must regenerate a usable (unencrypted) key.
    new_cert_path, new_key_path = store.ensure_cert("192.168.1.5")

    with open(new_key_path, "rb") as f:
        loaded_key = serialization.load_pem_private_key(f.read(), password=None)
    assert loaded_key.key_size == 2048
