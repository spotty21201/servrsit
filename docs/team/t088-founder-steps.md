# T-088 — founder steps on Sentani (root, your own session)

**For:** Spotty, on **Sentani only**, logged in as yourself (`ssh spotty@sentani`). Type your own sudo password when asked. ServrSit and the agents never see it.
**Why these are needed:** the helper is the only root path the Tester has. These steps need root outside it. Run each block only when its "When" line says so, and tell the Tester (through the Orchestrator) the line in **bold** at the end of each block.

---

## Decision first: how to get real pending updates for step 2

Right now, Sentani has **no** update that `apt-get upgrade` would install. The only pending ones are 11 systemd packages that Ubuntu is still rolling out in stages ("deferred due to phasing").

- **Option B (recommended):** step F1 below. You downgrade two harmless package groups to their original 24.04 versions. Their updates then become normal pending updates, which ServrSit installs back through the helper. Ubuntu's phasing is respected.
- **Option A:** no command. The Tester applies the 11 phased systemd packages through the helper, overriding the phasing. That restarts systemd itself and also systemd-resolved, systemd-timesyncd and udev during the update.

Tell the Tester **"T-088: option B"** (and do F1), or **"T-088: option A"**.

---

## F1 — downgrade two package groups (option B only)

**When:** now, if you chose option B.

First a simulation. It changes nothing. Check that the last line says `0 to remove`:

```
sudo apt-get -s install --allow-downgrades vim=2:9.1.0016-1ubuntu7 vim-common=2:9.1.0016-1ubuntu7 vim-runtime=2:9.1.0016-1ubuntu7 vim-tiny=2:9.1.0016-1ubuntu7 xxd=2:9.1.0016-1ubuntu7 libllvm18=1:18.1.3-1 libclang-cpp18=1:18.1.3-1 libclang1-18=1:18.1.3-1 | tail -n 3
```

If it says `0 to remove`, run the same command without `-s`:

```
sudo apt-get install -y --allow-downgrades vim=2:9.1.0016-1ubuntu7 vim-common=2:9.1.0016-1ubuntu7 vim-runtime=2:9.1.0016-1ubuntu7 vim-tiny=2:9.1.0016-1ubuntu7 xxd=2:9.1.0016-1ubuntu7 libllvm18=1:18.1.3-1 libclang-cpp18=1:18.1.3-1 libclang1-18=1:18.1.3-1
```

If the simulation shows **any** package to remove, or names a package other than the eight above, stop and send the output's last 10 lines instead.

Tell the Tester **"T-088 F1 done"**.

---

## F2 — hold one package for 10 minutes (held-package test)

**When:** after the Tester reports step 2 done.

```
sudo apt-mark hold libclang1-18 && sleep 600; sudo apt-mark unhold libclang1-18
```

This holds the package, waits 10 minutes, then releases the hold by itself. Leave the window open. Tell the Tester **"T-088 F2 started at HH:MM"** right after you press Enter. If the hold is still there afterwards, `sudo apt-mark unhold libclang1-18` removes it.

---

## F3 — hold the package-manager lock for 5 minutes (external apt activity / lock test)

**When:** after the Tester reports the F2 test done.

```
sudo python3 -c 'import apt_pkg,time; apt_pkg.init(); apt_pkg.pkgsystem_lock(); print("apt lock held for 300 s", flush=True); time.sleep(300)'
```

This takes the same lock that `apt` and `dpkg` take, holds it for 5 minutes, and releases it when it exits. Ctrl-C releases it early. Nothing is installed or changed. Tell the Tester **"T-088 F3 started at HH:MM"**.

---

## What the Tester does without you (for your information)

- Package installs: only through the helper, with manifests signed by ServrSit's key.
- Step 4: one reboot of Sentani through the helper.
- Step 5: as `spotty`, the Tester fills files under `~spotty/servrsit-t088-fill/` and removes them afterwards. Root's reserved disk space cannot be filled this way (see the report).
- Nothing on Nabire, Timika or Merauke.

Note: Sentani's next unattended upgrade is 2026-11-22 06:14 UTC. If F1 is done but the tests have not finished by then, unattended-upgrades may install the vim updates itself. Tell the Tester if that happens.
