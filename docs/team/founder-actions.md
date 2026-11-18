# Actions waiting for Spotty

Collected during the unattended run (ADR-016). Nothing here was done for you, because each one changes a real machine or needs your decision.

## 1. Fix Merauke's clock (important)

Merauke's clock is about **7 hours fast** and not synchronized. Its only time server (`123.235.232.172`) never answers. ServrSit computes every age, "fresh until" and expiry from Merauke's clock, so those times are currently wrong in the app. It may also be related to the Kiro "network error" problems (some signed cloud requests are rejected when the clock is off by more than a few minutes). That link is not proven.

Run on Merauke:

```
sudo mkdir -p /etc/systemd/timesyncd.conf.d
printf '[Time]\nNTP=time.cloudflare.com time.google.com ntp.ubuntu.com\n' | sudo tee /etc/systemd/timesyncd.conf.d/servrsit.conf
sudo systemctl restart systemd-timesyncd
sleep 20; timedatectl | grep -E "Universal|synchronized"
```

Expected: `System clock synchronized: yes`, and Universal time matching real UTC.

If it still says `no` (your network may block NTP), set it once from the web and tell Orchestrator:

```
sudo date -u -s "$(curl -sI https://www.google.com | grep -i '^date:' | cut -d' ' -f2-)"
```

## 2. Decisions still open
- Disposable Ubuntu server for write testing (you said: after development).
- AWS or other always-on host (you said: not yet).
- Optional: dedicated ServrSit key for Nabire.
- Optional: allow `sudo apt` install of browser libraries for automated screenshots.

## 3. Things you may want to know
- Sentani has 4 pending updates; 3 or more are Docker packages from Docker's own repository. ServrSit will list those separately and leave them out of Ubuntu update plans by default.
- Sentani's own automatic updates installed `sosreport` and two gstreamer packages on 17 Nov.
