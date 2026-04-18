# WIFIZONE ELITE — MikroTik RouterOS Configuration
# Apply with: /import router-config.rsc
#
# Physical wiring assumed:
#   ether1  → Starlink Router (WAN/DHCP client)
#   ether2  → Core Switch / Wired clients
#   wlan1   → WiFi Access Point / Clients

# ── STEP 1: WAN (DHCP from Starlink) ─────────────────────────────────────────
/ip dhcp-client add interface=ether1 disabled=no

# ── STEP 2: LAN bridge (ether2 + wlan1) ──────────────────────────────────────
/interface bridge add name=bridge1
/interface bridge port add interface=ether2 bridge=bridge1
/interface bridge port add interface=wlan1  bridge=bridge1

/ip address add address=192.168.88.1/24 interface=bridge1

/ip pool add name=dhcp_pool ranges=192.168.88.10-192.168.88.254

/ip dhcp-server add name=dhcp1 interface=bridge1 address-pool=dhcp_pool disabled=no
/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=8.8.8.8

# ── STEP 3: API + SNMP ────────────────────────────────────────────────────────
/ip service set api enabled=yes port=8728

/snmp set enabled=yes contact="operator" location="StarlinkSite"

# ── STEP 4: Hotspot profiles ──────────────────────────────────────────────────
/ip hotspot profile
add name=VIP     rate-limit=20M/20M idle-timeout=5m dns-name=wifi.zone
add name=REGULAR rate-limit=5M/5M   idle-timeout=5m dns-name=wifi.zone

/ip hotspot
add name=hotspot1 interface=bridge1 profile=REGULAR address-pool=dhcp_pool

/ip hotspot user profile
add name=VIP     quota-limit=2048M
add name=REGULAR quota-limit=1024M

# ── STEP 5: Firewall mangle — mark packets for queue tree ─────────────────────
# WiFi Zone OS adds client IPs to these address-lists via the MikroTik API
# when issuing a VIP vs. Regular session (setPerUserSpeed).
/ip firewall address-list
add list=wz-vip     address=0.0.0.0/32 comment="placeholder — managed by WiFi Zone OS"
add list=wz-regular address=0.0.0.0/32 comment="placeholder — managed by WiFi Zone OS"

/ip firewall mangle
add chain=forward src-address-list=wz-vip     action=mark-packet new-packet-mark=vip     passthrough=no comment=wifizone-vip
add chain=forward src-address-list=wz-regular action=mark-packet new-packet-mark=regular passthrough=no comment=wifizone-regular

# ── STEP 6: Queue tree (global bandwidth shaping) ─────────────────────────────
/queue tree
add name="VIP-Queue"     parent=global packet-mark=vip     limit-at=20M max-limit=20M
add name="REGULAR-Queue" parent=global packet-mark=regular limit-at=5M  max-limit=5M

# ── STEP 7: Per-user queue simple (set by WiFi Zone OS via API) ───────────────
# These are managed dynamically by backend/mikrotik.js → setPerUserSpeed().
# Example manual entry (replace IP and rate as needed):
#
# /queue simple add name=wifizone-192.168.88.10 target=192.168.88.10 max-limit=2M/2M comment=wifizone-auto
#
# VIP example:
# /queue simple add name=wifizone-192.168.88.11 target=192.168.88.11 max-limit=10M/10M comment=wifizone-auto

# ── STEP 8: NAT masquerade (internet sharing) ─────────────────────────────────
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade

# ── STEP 9: Scheduler + auto-balance script ───────────────────────────────────
/system scheduler
add name="quota-reset" interval=1d  on-event="/ip hotspot user set [find comment=wifizone-auto] bytes-in=0 bytes-out=0"
add name="autopilot"   interval=5m  on-event="/system script run auto-balance"

/system script
add name="auto-balance" source="\
:local load [/system resource get cpu-load];\
:if (\$load > 80) do={\
  /queue tree set VIP-Queue     max-limit=15M;\
  /queue tree set REGULAR-Queue max-limit=4M;\
} else={\
  /queue tree set VIP-Queue     max-limit=20M;\
  /queue tree set REGULAR-Queue max-limit=5M;\
}"
