#!/usr/bin/env bash
# Fix Merauke's system clock. Run ON Merauke:  bash /projects/servrsit/scripts/fix-merauke-clock.sh
# Asks for your sudo password. Changes only time-sync settings and the system clock.
set -euo pipefail

web_time() { curl -sI -m 10 https://www.google.com | grep -i '^date:' | cut -d' ' -f2- | tr -d '\r'; }
show() { echo "  Merauke now (UTC): $(date -u '+%F %T')"; echo "  Internet time:     $(web_time)"; timedatectl | grep -E 'synchronized' | sed 's/^ */  /'; }

echo "Before:"; show

echo "1/3 Pointing time sync at reliable servers..."
sudo mkdir -p /etc/systemd/timesyncd.conf.d
printf '[Time]\nNTP=time.cloudflare.com time.google.com ntp.ubuntu.com\n' | sudo tee /etc/systemd/timesyncd.conf.d/servrsit.conf >/dev/null
sudo timedatectl set-ntp true
sudo systemctl restart systemd-timesyncd

echo "2/3 Waiting up to 60 s for sync..."
for i in $(seq 1 12); do
  if [ "$(timedatectl show -p NTPSynchronized --value)" = "yes" ]; then echo "  Synchronized."; break; fi
  sleep 5
done

if [ "$(timedatectl show -p NTPSynchronized --value)" != "yes" ]; then
  echo "3/3 Network time (NTP) is not getting through. Setting the clock once from internet time instead."
  t="$(web_time)"
  [ -n "$t" ] || { echo "Could not read internet time. Nothing changed. Tell Kiro Orchestrator."; exit 1; }
  sudo date -u -s "$t" >/dev/null
  sudo hwclock --systohc 2>/dev/null || true
  echo "  Clock set. Note: without working NTP it will slowly drift again; tell Kiro Orchestrator."
else
  echo "3/3 Done via NTP."
fi

echo "After:"; show
echo "Tell Kiro Orchestrator: done."
