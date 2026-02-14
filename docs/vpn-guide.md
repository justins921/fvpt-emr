# VPN Remote Access Guide

## Overview

The FVPT-EMR system is designed for local network access only. For remote access,
use a VPN to securely tunnel into the clinic network. **NEVER expose the EMR directly
to the internet.**

## Recommended: WireGuard VPN

WireGuard is lightweight, fast, and easy to configure.

### Server Setup (on EMR server or router)

1. Install WireGuard:
   ```bash
   sudo apt install wireguard
   ```

2. Generate keys:
   ```bash
   wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
   chmod 600 /etc/wireguard/server_private.key
   ```

3. Configure /etc/wireguard/wg0.conf:
   ```ini
   [Interface]
   Address = 10.0.0.1/24
   ListenPort = 51820
   PrivateKey = <server_private_key>
   PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
   PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

   [Peer]
   PublicKey = <client_public_key>
   AllowedIPs = 10.0.0.2/32
   ```

4. Start:
   ```bash
   sudo systemctl enable wg-quick@wg0
   sudo systemctl start wg-quick@wg0
   ```

5. Open port 51820/UDP on clinic router (this is the ONLY port exposed externally).

### Client Setup (remote device)

1. Install WireGuard client (available for iOS, Android, Windows, Mac, Linux)

2. Configure client:
   ```ini
   [Interface]
   Address = 10.0.0.2/24
   PrivateKey = <client_private_key>
   DNS = <clinic_dns_server_ip>

   [Peer]
   PublicKey = <server_public_key>
   Endpoint = <clinic_public_ip>:51820
   AllowedIPs = 192.168.1.0/24, 10.0.0.0/24
   PersistentKeepalive = 25
   ```

3. Connect and access https://emr.local as if on clinic LAN.

## Security Notes

- Each remote user gets a unique key pair
- Revoke access by removing the peer from server config
- VPN traffic is encrypted with modern cryptography
- Log VPN connections for audit purposes
- Consider 2FA for VPN access as well
