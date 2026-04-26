# Starlink DNS Resilience for Captive Portals

Practical hardening guide to prevent *"DNS probe finished NXDOMAIN / no internet"*
errors during the brief (~10–15 s) connectivity gap that occurs when Starlink
switches between satellites.

---

## Why this happens

Starlink performs periodic satellite handoffs.  During a handoff the uplink is
interrupted for a window that typically ranges from **5 to 15 seconds**.  Client
operating systems use background DNS probes (e.g. Chrome's "DNS probe finished")
to detect internet connectivity.  If these probes time out or return NXDOMAIN
during the handoff, the OS declares the network offline and the captive-portal
page may display an error — even though the user's paid session is still valid.

---

## MikroTik / OpenWrt: Local DNS Caching

### 1. Enable dnsmasq caching with a generous TTL override

Add the following to `/etc/dnsmasq.conf` (OpenWrt) or use the RouterOS DNS
cache settings (MikroTik):

```
# Serve stale cache entries for up to 60 s while upstream is unreachable
# (covers a full Starlink handoff cycle with headroom)
cache-size=2048
local-ttl=60
neg-ttl=5
```

MikroTik RouterOS equivalent:

```
/ip dns set cache-size=2048 cache-max-ttl=1m
```

### 2. Pre-cache captive-portal hostname

Ensure the captive portal hostname always resolves locally so the portal
page never depends on upstream DNS:

```
# dnsmasq — hard-code the portal address
address=/wifi.local/192.168.88.1
```

---

## Captive Portal: DNS Probe Intercept

### 3. Intercept common connectivity-check hostnames

Client OSes probe a fixed set of hostnames to confirm internet access
(e.g. `connectivitycheck.gstatic.com`, `captive.apple.com`).  Serve local
responses to these probes so the OS considers the network "online" even
during a Starlink handoff.

**dnsmasq** (OpenWrt / Linux gateway):

```
address=/connectivitycheck.gstatic.com/192.168.88.1
address=/connectivitycheck.android.com/192.168.88.1
address=/captive.apple.com/192.168.88.1
address=/www.msftconnecttest.com/192.168.88.1
```

**MikroTik DNS static entries** (WinBox or terminal):

```
/ip dns static
add name=connectivitycheck.gstatic.com  address=192.168.88.1
add name=connectivitycheck.android.com  address=192.168.88.1
add name=captive.apple.com              address=192.168.88.1
add name=www.msftconnecttest.com        address=192.168.88.1
```

### 4. Serve minimal HTTP 204 responses

The OS connectivity checkers expect either a redirect (captive portal) or an
HTTP **204 No Content** (internet confirmed).  Add a lightweight Express
handler in the backend:

```js
// backend/server.js — already included in the router.json-driven setup
// Add this handler to make Android/iOS/Windows declare "online":
app.get('/generate_204',        (_req, res) => res.sendStatus(204));
app.get('/hotspot-detect.html', (_req, res) => res.sendStatus(204));
app.get('/ncsi.txt',            (_req, res) => res.send('Microsoft NCSI'));
app.get('/connecttest.txt',     (_req, res) => res.send('Microsoft Connect Test'));
```

---

## MikroTik Hotspot: Idle-Timeout Tuning

### 5. Increase idle-timeout to outlast the handoff window

By default MikroTik's hotspot profile may disconnect idle clients after only
a few seconds.  Raise this value to survive a full handoff:

```
/ip hotspot profile set [find name=default] idle-timeout=30s
/ip hotspot profile set [find name=REGULAR]  idle-timeout=30s
/ip hotspot profile set [find name=VIP]      idle-timeout=30s
```

The **handoff-buffer.js** module (15 s grace window) works in tandem with this
setting: even if MikroTik removes the client during a handoff, the reconciliation
loop will re-provision the session within the next tick — and extend the
`end_time` to compensate for the lost time.

---

## Starlink Bypass Mode: MTU / MSS Clamping

### 6. Clamp MSS to account for CGNAT overhead

Starlink uses CGNAT which adds extra encapsulation headers.  Oversized packets
get silently dropped, causing HTTP stalls that look like DNS failures.

```
/ip firewall mangle
add chain=forward protocol=tcp tcp-flags=syn \
    action=change-mss new-mss=clamp-to-pmtu \
    passthrough=yes comment="Starlink MSS clamp"
```

Linux / iptables equivalent:

```bash
iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \
         -j TCPMSS --clamp-mss-to-pmtu
```

---

## Summary Checklist

| # | Action | Expected outcome |
|---|--------|-----------------|
| 1 | dnsmasq `cache-size=2048`, `local-ttl=60` | Cached DNS survives a 15 s handoff |
| 2 | Pre-cache `wifi.local` → gateway IP | Portal always resolves, even offline |
| 3 | Static DNS for OS probe hostnames | OS declares network "online" |
| 4 | HTTP 204 handler for `/generate_204` etc. | Chrome / iOS / Windows stop showing "no internet" |
| 5 | `idle-timeout=30s` on hotspot profiles | MikroTik keeps clients connected through handoff |
| 6 | MSS clamping for Starlink CGNAT | Eliminates silent packet drops |

With these changes in place, end-users will experience Starlink satellite
handoffs as a momentary blip rather than a full network disconnect.
