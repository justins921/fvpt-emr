#!/usr/bin/env bash
set -euo pipefail

# Generate a local CA and certificate for HTTPS on LAN
# This creates a self-signed CA that can be trusted by local devices

CERT_DIR="./docker/certs"
DOMAIN="${1:-emr.local}"

mkdir -p "$CERT_DIR"

echo "=== Local CA & Certificate Setup ==="
echo "Domain: $DOMAIN"

# Generate CA key and certificate
if [ ! -f "$CERT_DIR/ca.key" ]; then
  echo "[1/3] Creating local CA..."
  openssl genrsa -out "$CERT_DIR/ca.key" 4096
  openssl req -x509 -new -nodes -key "$CERT_DIR/ca.key" -sha256 -days 3650 \
    -out "$CERT_DIR/ca.crt" \
    -subj "/C=US/ST=Local/L=Clinic/O=FVPT-EMR/CN=FVPT-EMR Local CA"
  echo "  CA created: $CERT_DIR/ca.crt"
else
  echo "[1/3] CA already exists, skipping."
fi

# Generate server certificate
echo "[2/3] Creating server certificate for $DOMAIN..."
openssl genrsa -out "$CERT_DIR/server.key" 2048

cat > "$CERT_DIR/server.ext" << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment
subjectAltName=@alt_names

[alt_names]
DNS.1=$DOMAIN
DNS.2=localhost
IP.1=127.0.0.1
EOF

openssl req -new -key "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.csr" \
  -subj "/C=US/ST=Local/L=Clinic/O=FVPT-EMR/CN=$DOMAIN"

openssl x509 -req -in "$CERT_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/server.crt" -days 365 -sha256 \
  -extfile "$CERT_DIR/server.ext"

rm "$CERT_DIR/server.csr" "$CERT_DIR/server.ext"

echo "[3/3] Done!"
echo ""
echo "Files created:"
echo "  CA Certificate: $CERT_DIR/ca.crt (install this on client devices)"
echo "  Server Cert:    $CERT_DIR/server.crt"
echo "  Server Key:     $CERT_DIR/server.key"
echo ""
echo "To trust the CA on iPads/Macs:"
echo "  1. Transfer ca.crt to the device"
echo "  2. Settings > General > VPN & Device Management > Install profile"
echo "  3. Settings > General > About > Certificate Trust Settings > Enable"
echo ""
echo "To trust on Windows:"
echo "  1. Double-click ca.crt > Install Certificate"
echo "  2. Local Machine > Trusted Root Certification Authorities"
echo ""
echo "To trust on Linux:"
echo "  sudo cp $CERT_DIR/ca.crt /usr/local/share/ca-certificates/"
echo "  sudo update-ca-certificates"
