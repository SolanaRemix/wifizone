# WIFIZONE ELITE — MikroTik RouterOS Configuration
# Apply with: /import router-config.rsc

/ip service set api enabled=yes port=8728

/snmp set enabled=yes contact="operator" location="StarlinkSite"

/ip hotspot profile
add name=VIP     rate-limit=20M/20M idle-timeout=5m
add name=REGULAR rate-limit=5M/5M   idle-timeout=5m

/ip hotspot
add name=hotspot1 interface=bridge1 profile=REGULAR address-pool=hs-pool-1

/ip hotspot user profile
add name=VIP     quota-limit=2048M
add name=REGULAR quota-limit=1024M

/queue tree
add name="VIP-Queue"     parent=global packet-mark=vip     limit-at=20M max-limit=20M
add name="REGULAR-Queue" parent=global packet-mark=regular limit-at=5M  max-limit=5M

/system scheduler
add name="quota-reset" interval=1d  on-event="/tool user-manager reset-counters"
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
