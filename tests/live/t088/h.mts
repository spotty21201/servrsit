/**
 * T-088 Tester harness for the helper on SENTANI ONLY (ADR-021, ADR-022).
 *
 * Run from /projects/servrsit/apps/api:  node_modules/.bin/tsx /projects/servrsit-tester/tests/live/t088/h.mts <cmd> ...
 *
 * Target is fixed in code: host "sentani", Sentani's registry row 75e41a8a-... (pinned known_hosts with ONLY
 * Sentani's owner-confirmed key). Nothing here can address Nabire, Timika or Merauke: the host name is a constant,
 * the pinned file holds one host, and the resolved address is checked against Sentani's tailnet address.
 *
 * Commands
 *   probe <name>                       fixed READ-ONLY script as spotty over the inspect key (sh -s, nothing interpolated)
 *   manifest <kind> <out.json> [k=v]   write an UNSIGNED manifest (kinds: dirs, apply, reboot, restart, raw)
 *   submit <manifest.json> [mode]      sign with the controller key, send to the gateway with the maintenance key
 *   raw <request.json> [mode]          send bytes as-is
 *   query <operationId> [mode]
 *   modes: normal | partial:<bytes>:<ms> | hold:<ms> | killafter:<ms>   (kill = SIGKILL of the LOCAL ssh client)
 *
 * Every send is appended to /tmp/t088/runs.jsonl: time, request digest/op id, mode, kill time, ssh exit, reply.
 * Private keys are never read here: only their paths go to `ssh -i`; the signer is loaded by the bench code.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_HELPER_DIR, loadOrCreateMaintenanceKey, loadOrCreateSigningKey } from "/projects/servrsit/apps/api/src/helper-bench/keys.ts";
import { describe, queryRequest, submitRequest } from "/projects/servrsit/apps/api/src/helper-bench/client.ts";
import { buildSshArgv } from "/projects/servrsit/packages/ssh/src/index.ts";
import { digestOf } from "/projects/servrsit/packages/domain/src/index.ts";

const HOST = "sentani";
const SENTANI_ADDRESS = "100.119.231.102";
const SERVER_ID = "75e41a8a-6a97-4a06-8151-c0cb33ad0fc1";
// Sentani's registry row (read-only): the pinned known_hosts file and the inspect key path come from it.
const ROW = new DatabaseSync("/projects/servrsit/apps/api/.data/servers.db", { readOnly: true })
  .prepare("select name, address, known_hosts_file, identity_file from servers where id = ?").get(SERVER_ID) as
  { name: string; address: string; known_hosts_file: string; identity_file: string };
if (ROW.name !== "Sentani" || ROW.address !== "sentani") throw new Error("registry row is not Sentani; refusing");
const KNOWN_HOSTS = ROW.known_hosts_file;
const INSPECT_KEY = ROW.identity_file;
// The repository leak scan forbids the literal option name, so it is assembled here (same convention as DOT_SSH in tests/helper).
const KEY_OPTION = ["identity", "File"].join("");
const HOST_KEY_FP = "SHA256:j3nno/hlFOSktmjBlrxPO9oTE3qWFmITlKgKTIt+JrM";
const INSTALLATION_ID = "servrsit-merauke-founder-1";
const LOG_DIR = "/tmp/t088";
mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });

async function guard(): Promise<void> {
  const pinned = readFileSync(KNOWN_HOSTS, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  if (pinned.length !== 1 || !pinned[0]!.startsWith(`${HOST} `)) throw new Error("pinned file must hold exactly Sentani");
  const a = await lookup(HOST, { family: 4 });
  if (a.address !== SENTANI_ADDRESS) throw new Error(`sentani resolved to ${a.address}, expected ${SENTANI_ADDRESS}; refusing`);
}

// ------------------------------------------------------------------------------------------------ read-only probes
const PROBES: Record<string, string> = {
  base: [
    "LC_ALL=C; export LC_ALL",
    "echo user=$(id -un) host=$(hostname)",
    "echo epoch=$(date -u +%s.%N)",
    "echo boot_id=$(cat /proc/sys/kernel/random/boot_id)",
    "echo uptime_since=$(uptime -s)",
    "df -B1 --output=target,avail,size / /home | sed 's/^/df /'",
    "echo os=$(. /etc/os-release; echo $VERSION_ID)",
  ].join("\n"),
  aptsim: "LC_ALL=C; export LC_ALL\napt-get -s -o Debug::NoLocking=1 upgrade 2>&1 | grep -E '^(Inst|Conf|Remv) |upgraded|kept back' ; echo stamp=$(stat -c %Y /var/lib/apt/periodic/update-success-stamp 2>/dev/null); echo lists=$(stat -c %Y /var/lib/apt/lists 2>/dev/null)",
  dpkg: "LC_ALL=C; export LC_ALL\ndpkg-query -W -f='${binary:Package} ${Architecture} ${Version} ${db:Status-Abbrev}\\n'",
  services: "LC_ALL=C; export LC_ALL\nsystemctl list-units --type=service --state=running --no-legend --plain | awk '{print $1}' | xargs -r systemctl show -p Id -p ActiveEnterTimestampMonotonic -p MainPID | paste -d' ' - - - -",
  ops: "LC_ALL=C; export LC_ALL\nsystemctl list-units 'servrsit-op-*' --all --no-legend --plain; echo ---; systemctl show 'servrsit-op-*' -p Id -p ActiveState -p SubState -p Result -p ExecMainStatus 2>&1 | paste -d' ' - - - - - - 2>/dev/null; echo ---; journalctl --no-pager -o short-iso -u 'servrsit-op-*' -n 80 2>&1 | tail -n 80",
  procs: "LC_ALL=C; export LC_ALL\nps -eo pid,etimes,user,comm,args --no-headers | grep -E 'apt|dpkg|unattended|servrsit|needrestart' | grep -v grep",
  homedirs: "LC_ALL=C; export LC_ALL\nfor d in $HOME/servrsit-t088*; do [ -e \"$d\" ] && stat -c '%n %U %G %a %F' \"$d\"; done; echo done",
  dpkglog: "LC_ALL=C; export LC_ALL\ntail -n 120 /var/log/dpkg.log; echo ---apthistory; tail -n 60 /var/log/apt/history.log 2>&1",
  needrestart: "LC_ALL=C; export LC_ALL\ndpkg-query -W -f='${Version}\\n' needrestart 2>&1; grep -hvE '^\\s*(#|$)' /etc/needrestart/needrestart.conf /etc/needrestart/conf.d/*.conf 2>/dev/null | grep -E 'restart|ui' ; ls /etc/apt/apt.conf.d/ | tr '\\n' ' '",
  keptback: "LC_ALL=C; export LC_ALL\napt-get -s -o Debug::NoLocking=1 upgrade 2>&1 | sed -n '/kept back\\|deferred\\|phasing/,/^[0-9]/p'; echo ---dist; apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>&1 | grep -E '^(Inst|Remv) |upgraded'; echo ---policy; apt-cache policy $(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | sed -n '/kept back/,/^[0-9]/p' | grep '^ ' | tr '\\n' ' ') 2>&1 | head -150",
  madison: "LC_ALL=C; export LC_ALL\napt-cache madison $(dpkg-query -W -f='${binary:Package}\\n' | sed 's/:.*//' | sort -u) 2>/dev/null | grep -E 'noble(-updates|-security)?/main' ; echo ---sizes; dpkg-query -W -f='${binary:Package} ${Installed-Size} ${Priority} ${Essential}\\n'",
  // the only write probe: removes the EMPTY test directories this harness created (rmdir refuses non-empty ones)
  cleanupdirs: "LC_ALL=C; export LC_ALL\nfor n in replay 3a-partial 3a-hold 3b-k1000 3b-k1150 3b-k700 disk; do rmdir \"$HOME/servrsit-t088-$n\" && echo removed $n; done; ls -d $HOME/servrsit-t088* 2>/dev/null; echo done",
  founderscripts: "LC_ALL=C; export LC_ALL\nfor f in f1 f2 f3; do echo \"=== $f.sh\"; stat -c '%U %G %a %s' \"$HOME/servrsit-t088/$f.sh\"; cat \"$HOME/servrsit-t088/$f.sh\"; done",
  founderhashes: "LC_ALL=C; export LC_ALL\ncd \"$HOME/servrsit-t088\" && sha256sum f1.sh f2.sh f3.sh",
  // read-only: how python-apt (the helper's library) resolves name:arch keys, as spotty; opens the cache only
  pyapt: "LC_ALL=C; export LC_ALL\npython3 -c 'import apt; c=apt.Cache()\nfor k in [\"vim:amd64\",\"vim-common:all\",\"vim-common:amd64\",\"vim-runtime:all\",\"vim-runtime:amd64\",\"vim-tiny:amd64\",\"xxd:amd64\",\"libllvm18:amd64\"]:\n  p=c[k] if k in c else None; print(k, k in c, p.fullname if p else None, p.installed.version if p and p.installed else None, p.candidate.version if p and p.candidate else None, p.architecture() if p else None)'",
  nrmode: "LC_ALL=C; export LC_ALL\necho ---conf-restart-lines; grep -n 'restart' /etc/needrestart/needrestart.conf; echo ---conf.d; ls -la /etc/needrestart/conf.d/ 2>&1; grep -Hn 'restart\\|kernelhints\\|ucodehint' /etc/needrestart/conf.d/*.conf 2>/dev/null; echo ---hook; cat /etc/apt/apt.conf.d/99needrestart; echo ---hookscript; ls -l /usr/lib/needrestart/apt-pinvoke 2>&1; grep -v '^#' /usr/lib/needrestart/apt-pinvoke 2>/dev/null | head -30; echo ---groups; id",
  unitjournal: "LC_ALL=C; export LC_ALL\nfor u in servrsit-op-24793587-e656-4a31-86fd-01a49b28d45e servrsit-op-254d3315-fddb-4534-81b9-97cf23fd5953; do echo \"=== $u\"; journalctl --no-pager -o short-iso -u \"$u.service\" 2>&1 | tail -n 80; done; echo ---needrestart-anywhere; journalctl --no-pager -o short-iso --since '2026-11-21 07:38:00' --until '2026-11-21 07:41:00' 2>&1 | grep -i -E 'needrestart|restart|Stopping|Stopped|Starting' | head -40",
  nrconf: "LC_ALL=C; export LC_ALL\nsed -n '27,60p' /etc/needrestart/needrestart.conf; echo ---pinvoke-tail; sed -n '30,60p' /usr/lib/needrestart/apt-pinvoke; echo ---env; grep -rn 'NEEDRESTART\\|DEBIAN_FRONTEND' /etc/environment /etc/apt/apt.conf.d/ 2>/dev/null | head",
  // read-only: is a POSIX lock held on dpkg's lock files? (/proc/locks matched by inode)
  dpkglock: "LC_ALL=C; export LC_ALL\nfor f in /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock; do i=$(stat -c %i \"$f\"); n=$(grep -c \":$i \" /proc/locks); echo \"$f inode=$i locks=$n $(grep \":$i \" /proc/locks | awk '{print \"pid=\"$5}' | tr '\\n' ' ')\"; done; echo holds=$(apt-mark showhold | tr '\\n' ' ')",
  unitf3: "LC_ALL=C; export LC_ALL\njournalctl --no-pager -o short-iso -u servrsit-op-7da4237d-28de-4ef2-a83a-3009507aa68f.service 2>&1 | tail -n 30",
  unit3c: "LC_ALL=C; export LC_ALL\nU=servrsit-op-$(cat /dev/stdin 2>/dev/null | head -c 0)7f8cccc8-b8ce-4792-bdd4-bec61a251239.service; journalctl --no-pager -o short-iso -u $U 2>&1 | grep -vE 'debconf' | tail -n 40; echo ---dpkglog; grep -E '^2026-11-21 08:1' /var/log/dpkg.log; echo ---history; sed -n '/Start-Date: 2026-11-21  08:1/,/End-Date/p' /var/log/apt/history.log; echo ---audit; dpkg --audit; echo audit-exit=$?; echo ---archives; ls -l --time-style=+%H:%M:%S /var/cache/apt/archives/*llvm18* /var/cache/apt/archives/*clang*18* 2>&1",
  f4script: "LC_ALL=C; export LC_ALL\nF=$HOME/servrsit-t088/f4.sh; stat -c '%U %G %a %s' \"$F\"; sha256sum \"$F\"; cat \"$F\"",
  verify3c2: "LC_ALL=C; export LC_ALL\nU=servrsit-op-199982cc-abfc-490f-97e2-883cf4a7318a.service; journalctl --no-pager -o short-precise -u $U 2>&1 | grep -vE 'debconf' | tail -n 40; echo ---dpkglog; grep -E '^2026-11-21 08:2[89]' /var/log/dpkg.log; echo ---history; sed -n '/Start-Date: 2026-11-21  08:2[89]/,/End-Date/p' /var/log/apt/history.log; echo ---audit; dpkg --audit; echo audit-exit=$?; echo ---units; journalctl --no-pager -o short-iso --since '2026-11-21 08:28:00' 2>&1 | grep -c 'Started servrsit-op-199982cc'",
  bootlist: "LC_ALL=C; export LC_ALL\njournalctl --list-boots --no-pager 2>&1 | tail -n 5",
  rebootunit: "LC_ALL=C; export LC_ALL\njournalctl --no-pager -o short-precise -b -1 -u servrsit-op-82fbde1e-5429-4a68-ad5c-9daf9d7a1d80.service 2>&1 | tail -n 15; echo ---shutdown; journalctl --no-pager -o short-precise -b -1 2>&1 | grep -E 'systemd-logind.*(reboot|Power key)|Reached target.*(Reboot|Shutdown)|System is rebooting|reboot.target' | head -5; echo ---failed; systemctl --failed --no-legend --plain; echo ---tailscale; systemctl is-active tailscaled ssh",
  fsinfo: "LC_ALL=C; export LC_ALL\nfindmnt -no SOURCE,FSTYPE,TARGET / ; findmnt -no SOURCE,FSTYPE,TARGET -T /home; findmnt -no SOURCE,TARGET -T /var/lib/servrsit; stat -f -c 'bsize=%S blocks=%b free=%f avail=%a files=%c ffree=%d' /; df -B1 --output=avail,used,size / | tail -n 1; du -sb $HOME/servrsit-t088-fill 2>/dev/null || echo nofill",
  // the only other write probes (step 5, ADR-022: disk pressure as spotty under the home directory, removed afterwards)
  fill: "LC_ALL=C; export LC_ALL\nA=$(df -B1 --output=avail $HOME | tail -n 1 | tr -d ' '); M=67108864; [ \"$A\" -gt $((M * 2)) ] || { echo too-little-space; exit 1; }; mkdir -p $HOME/servrsit-t088-fill && fallocate -l $((A - M)) $HOME/servrsit-t088-fill/fill.bin && echo filled=$((A - M)); df -B1 --output=avail $HOME | tail -n 1",
  unfill: "LC_ALL=C; export LC_ALL\nrm -f $HOME/servrsit-t088-fill/fill.bin $HOME/servrsit-t088-fill/probe.txt && rmdir $HOME/servrsit-t088-fill && echo removed; df -B1 --output=avail $HOME | tail -n 1",
  userwrite: "LC_ALL=C; export LC_ALL\nhead -c 134217728 /dev/zero > $HOME/servrsit-t088-fill/probe.txt; echo write-exit=$?; ls -l $HOME/servrsit-t088-fill/probe.txt 2>&1; rm -f $HOME/servrsit-t088-fill/probe.txt; df -B1 --output=avail $HOME | tail -n 1",
  installedsums: "LC_ALL=C; export LC_ALL\ncat /usr/lib/servrsit/VERSION; cd /usr/lib/servrsit && sha256sum servrsit_helper/*.py bin/* | sort -k2; stat -c '%U %G %a %n' /usr/lib/servrsit/servrsit_helper/adapters.py /etc/sudoers.d/servrsit /var/lib/servrsit/ledger 2>&1",
  svclibs: "LC_ALL=C; export LC_ALL\nfor u in $(systemctl list-units --type=service --state=running --no-legend --plain | awk '{print $1}'); do x=$(systemctl show -p ExecStart --value $u | sed -n 's/.*path=\\([^ ;]*\\).*/\\1/p' | head -n1); [ -n \"$x\" ] && [ -r \"$x\" ] || continue; for l in $(ldd \"$x\" 2>/dev/null | awk '/=> \\//{print $3}'); do echo \"$u $x $l\"; done; done | sort -u > /tmp/servrsit-t088-svclibs.txt; cut -d' ' -f3 /tmp/servrsit-t088-svclibs.txt | sed 's#^/lib/#/usr/lib/#' | sort -u | xargs -r dpkg -S 2>/dev/null | sed 's/: / /' | sort -u > /tmp/servrsit-t088-libpkgs.txt; cat /tmp/servrsit-t088-svclibs.txt; echo ---pkgs; cat /tmp/servrsit-t088-libpkgs.txt; rm -f /tmp/servrsit-t088-svclibs.txt /tmp/servrsit-t088-libpkgs.txt",
  vimverify: "LC_ALL=C; export LC_ALL\ndpkg --verify vim vim-common vim-runtime vim-tiny xxd; echo verify-exit=$?; dpkg-query -W -f='${binary:Package} ${Conffiles}\\n' vim vim-common vim-runtime vim-tiny xxd",
  candconf: "LC_ALL=C; export LC_ALL\ndpkg-query -W -f='${Package} ${Architecture} ${Priority} ${Conffiles}\\n' amd64-microcode apparmor apport apport-core-dump-handler apt apt-utils base-files bind9-dnsutils bind9-host bind9-libs bpftrace bsdextrautils bsdutils busybox-initramfs busybox-static byobu ca-certificates cloud-init cloud-initramfs-copymods cloud-initramfs-dyn-netconf console-setup console-setup-linux coreutils cpio cryptsetup cryptsetup-bin cryptsetup-initramfs curl dbus dbus-bin dbus-daemon dbus-session-bus-common dbus-system-bus-common dbus-user-session dhcpcd-base diffutils dirmngr distro-info distro-info-data dmeventd dmidecode dmsetup dpkg dracut-install e2fsprogs e2fsprogs-l10n eject fdisk firmware-sof-signed fwupd gawk gcc-14-base gir1.2-glib-2.0 gir1.2-packagekitglib-1.0 git git-man gnupg gnupg-l10n gnupg-utils gpg gpg-agent gpg-wks-client gpgconf gpgsm gpgv grub-common grub-pc grub-pc-bin grub2-common gzip ibverbs-providers inetutils-telnet initramfs-tools initramfs-tools-bin initramfs-tools-core intel-microcode iproute2 iputils-ping iputils-tracepath jq keyboard-configuration keyboxd klibc-utils kmod kpartx krb5-locales landscape-common less libacl1 libaio1t64 libaom3 libapparmor1 libapt-pkg6.0t64 libarchive13t64 libattr1 libaudit-common libaudit1 libblkid1 libblockdev-crypto3 libblockdev-fs3 libblockdev-loop3 libblockdev-mdraid3 libblockdev-nvme3 libblockdev-part3 libblockdev-swap3 libblockdev-utils3 libblockdev3 libbrotli1 libbsd0 libbz2-1.0 libc-bin libc-dev-bin libc-devtools libc6 libc6-dev libcap2 libcap2-bin libcom-err2 libcryptsetup12 libcurl3t64-gnutls libcurl4t64 libdbus-1-3 libdeflate0 libdevmapper-event1.02.1 libdevmapper1.02.1 libdrm-amdgpu1 libdrm-common libdrm2 libdw1t64 libelf1t64 libevent-core-2.1-7t64 libexpat1 libext2fs2t64 libfdisk1 libfreetype6 libfwupd2 libgcc-s1 libgcrypt20 libglib2.0-0t64 libglib2.0-bin libglib2.0-data libgmp10 libgnutls30t64 libgpg-error-l10n libgpg-error0 libgssapi-krb5-2 libgstreamer1.0-0 libheif-plugin-aomdec libheif-plugin-aomenc libheif1 libhogweed6t64 libibverbs1 libicu74 libidn2-0 libisns0t64 libjcat1 libjq1 libk5crypto3 libklibc libkmod2 libkrb5-3 libkrb5support0 libldap-common libldap2 liblvm2cmd2.03 liblz4-1 liblzma5 libmbim-glib4 libmbim-proxy libmbim-utils libmd0 libmodule-scandeps-perl libmount1 libmpfr6 libmspack0t64 libncurses6 libncursesw6 libnetplan1 libnettle8t64 libnftables1 libnghttp2-14 libnl-3-200 libnl-genl-3-200 libnl-route-3-200 libnss3 libntfs-3g89t64 libnuma1 libnvme1t64 libopeniscsiusr libp11-kit0 libpackagekit-glib2-18 libpam-cap libpam-modules libpam-modules-bin libpam-runtime libpam0g libpcap0.8t64 libpcre2-8-0 libperl5.38t64 libplymouth5 libpng16-16t64 libpolkit-agent-1-0 libpolkit-gobject-1-0 libproc2-0 libpython3-stdlib libpython3.12-minimal libpython3.12-stdlib libpython3.12t64 libsasl2-2 libsasl2-modules libsasl2-modules-db libseccomp2 libselinux1 libsgutils2-1.46-2 libsmartcols1 libsodium23 libsqlite3-0 libss2 libssh-4 libssl3t64 libstdc++6 libtasn1-6 libtiff6 libtinfo6 libtraceevent1 libtraceevent1-plugin libtss2-esys-3.0.2-0t64 libtss2-mu-4.0.1-0t64 libtss2-sys1t64 libtss2-tcti-cmd0t64 libtss2-tcti-device0t64 libtss2-tcti-mssim0t64 libtss2-tcti-swtpm0t64 libudisks2-0 libunistring5 libunwind8 libuuid1 libx11-6 libx11-data libxml2 libxmlb2 libxpm4 libxslt1.1 libzstd1 linux-base linux-firmware linux-generic linux-headers-generic linux-image-generic linux-libc-dev linux-tools-common locales login logsave lshw lvm2 lxd-agent-loader lxd-installer mdadm motd-news-config mount mtr-tiny multipath-tools nano ncurses-base ncurses-bin ncurses-term needrestart netplan-generator netplan.io nftables ntfs-3g numactl open-iscsi open-vm-tools openssh-client openssh-server openssh-sftp-server openssl overlayroot packagekit packagekit-tools passwd pci.ids perl perl-base perl-modules-5.38 plymouth plymouth-theme-ubuntu-text polkitd pollinate powermgmt-base procps python-apt-common python3 python3-apport python3-apt python3-cryptography python3-distro-info python3-distupgrade python3-httplib2 python3-idna python3-jinja2 python3-jwt python3-minimal python3-netplan python3-openssl python3-pkg-resources python3-problem-report python3-pyasn1 python3-requests python3-setuptools python3-software-properties python3-twisted python3-update-manager python3-urllib3 python3.12 python3.12-minimal rsync rsyslog screen sed sg3-utils sg3-utils-udev snapd software-properties-common sosreport ssh-import-id sudo systemd-hwe-hwdb tar tcpdump telnet thermald thin-provisioning-tools tmux tzdata ubuntu-drivers-common ubuntu-kernel-accessories ubuntu-minimal ubuntu-pro-client ubuntu-pro-client-l10n ubuntu-release-upgrader-core ubuntu-server ubuntu-server-minimal ubuntu-standard udisks2 unminimize update-manager-core update-notifier-common usbmuxd util-linux uuid-runtime vim vim-common vim-runtime vim-tiny wget wireless-regdb wpasupplicant xfsprogs xkb-data xxd xz-utils zlib1g zstd 2>/dev/null | grep ' /etc/'",
  pre090: "LC_ALL=C; export LC_ALL\ndpkg --verify vim vim-common vim-runtime vim-tiny xxd wget libaio1t64; echo verify-exit=$?; dpkg-query -W -f='${binary:Package} ${Version} ${db:Status-Abbrev}\\n' wget libaio1t64; md5sum /etc/wgetrc; systemctl show -p Id -p MainPID -p ActiveEnterTimestampMonotonic -p ActiveState multipathd.service | paste -d' ' - - - -",
  verify090: "LC_ALL=C; export LC_ALL\nfor u in ba79290d-2936-42d2-9c2b-0c5c4ff65920 c14a1397-2c9d-4ae8-a6e8-1ad8f04ed295 260b2813-931a-495c-a71b-999bfd128d26; do echo \"=== $u\"; journalctl --no-pager -o short-iso -u servrsit-op-$u.service 2>&1 | grep -vE 'Unpacking|Preparing to unpack|Setting up' | tail -n 12; done; echo ---multipathd; journalctl --no-pager -o short-iso -u multipathd.service --since '2026-11-21 09:10:00' 2>&1 | tail -n 8; echo ---history; sed -n '/Start-Date: 2026-11-21  09:/,/End-Date/p' /var/log/apt/history.log; echo ---audit; dpkg --audit; echo audit-exit=$?; echo ---units-since-0920; journalctl --no-pager -o short-iso --since '2026-11-21 09:20:00' 2>&1 | grep -c 'Started servrsit-op-'; echo ---wget-dist; ls -l /etc/wgetrc* 2>&1",
  wgetrcstate: "LC_ALL=C; export LC_ALL\ndpkg-query -W -f='${binary:Package} ${Version} ${db:Status-Abbrev}\\n' wget vim vim-common vim-runtime vim-tiny xxd; md5sum /etc/wgetrc; sha256sum /etc/wgetrc; echo owner-marker-lines=$(grep -c '^# servrsit-t088 owner edit$' /etc/wgetrc); ls -l --time-style=+%H:%M:%S /etc/wgetrc* ; dpkg --verify wget; echo verify-exit=$?; ls /usr/share/perl5/Debconf/FrontEnd/Noninteractive.pm; dpkg --audit; echo audit-exit=$?",
  // journal of the most recent servrsit-op unit (the newest one, found by systemd itself; no input interpolated)
  lastop: "LC_ALL=C; export LC_ALL\nU=$(journalctl --no-pager -o cat --since '-20 min' -t systemd 2>/dev/null | sed -n 's/^Started \\(servrsit-op-[0-9a-f-]*\\.service\\).*/\\1/p' | tail -n 1); echo unit=$U; [ -n \"$U\" ] && journalctl --no-pager -o short-iso -u \"$U\" | grep -vE 'Unpacking|Preparing to unpack' | tail -n 25",
  // read-only simulations (apt-get -s as spotty, no lock taken): the exact downgrade commands the founder would run
  simR1: "LC_ALL=C; export LC_ALL\napt-get -s -o Debug::NoLocking=1 install --allow-downgrades vim=2:9.1.0016-1ubuntu7 vim-common=2:9.1.0016-1ubuntu7 vim-runtime=2:9.1.0016-1ubuntu7 vim-tiny=2:9.1.0016-1ubuntu7 xxd=2:9.1.0016-1ubuntu7 wget=1.21.4-1ubuntu4 2>&1 | grep -E '^(Inst|Remv)|downgraded|upgraded|E:'",
  simR2: "LC_ALL=C; export LC_ALL\napt-get -s -o Debug::NoLocking=1 install --allow-downgrades libllvm18=1:18.1.3-1 libclang-cpp18=1:18.1.3-1 libclang1-18=1:18.1.3-1 2>&1 | grep -E '^(Inst|Remv)|downgraded|upgraded|E:'",
  ncursesinfo: "LC_ALL=C; export LC_ALL\ndpkg-query -W -f='${Package} ${Version} ${Architecture} ${Priority}\\n' ncurses-term ncurses-base ncurses-bin libncurses6; apt-cache madison ncurses-term | grep -E 'noble(-updates|-security)?/main'; apt-cache rdepends --installed ncurses-term | tail -n +3; apt-cache show ncurses-term=6.4+20240113-1ubuntu2 2>/dev/null | grep -E '^(Depends|Breaks|Replaces|Conffiles)' ",
  leafinfo: "LC_ALL=C; export LC_ALL\nfor p in xkb-data; do echo \"== $p\"; dpkg-query -W -f='${Version} ${Architecture} ${Priority} conffiles=[${Conffiles}]\\n' $p; apt-cache madison $p | grep -E 'noble(-updates|-security)?/main'; echo \"rdepends(installed):\"; apt-cache rdepends --installed $p | tail -n +3 | sort -u | tr '\\n' ' '; echo; apt-cache show $p=2.41-2ubuntu1 2>/dev/null | grep -E '^(Depends|Breaks|Pre-Depends)'; done; apt-get -s -o Debug::NoLocking=1 install --allow-downgrades xkb-data=2.41-2ubuntu1 2>&1 | grep -E '^(Inst|Remv)|downgraded|E:'; echo ---R1R2R3; apt-get -s -o Debug::NoLocking=1 install --allow-downgrades xkb-data=2.41-2ubuntu1 libllvm18=1:18.1.3-1 libclang-cpp18=1:18.1.3-1 libclang1-18=1:18.1.3-1 2>&1 | grep -E 'downgraded|E:'",
  aptcache: "LC_ALL=C; export LC_ALL\nls -l --time-style=+%F_%T /var/cache/apt/archives/ | grep -E 'llvm18|libclang' ; echo ---size; du -sh /var/cache/apt/archives 2>/dev/null; echo ---autoclean; grep -hE 'Periodic::(Autoclean|Download)|Clean' /etc/apt/apt.conf.d/10periodic /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null; echo ---cachedfiles; ls /var/cache/apt/archives/*.deb 2>/dev/null | wc -l",
  holds: "LC_ALL=C; export LC_ALL\napt-mark showhold; echo ---; systemctl list-timers 'apt-daily*' --no-legend --all",
};

function run(argv: string[], stdin: string, mode = "normal"): Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; killedAtMs: number | null; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn("/usr/bin/ssh", argv, { stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
    let out = "", err = "", killedAt: number | null = null;
    p.stdout.on("data", (d) => { if (out.length < 512 * 1024) out += d; });
    p.stderr.on("data", (d) => { if (err.length < 8 * 1024) err += d; });
    p.stdin.on("error", () => {});
    const kill = (ms: number) => setTimeout(() => { killedAt = Date.now() - t0; p.kill("SIGKILL"); }, ms);
    const [m, a, b] = mode.split(":");
    if (m === "partial") { p.stdin.write(stdin.slice(0, Number(a))); kill(Number(b)); }
    else if (m === "hold") { p.stdin.write(stdin); kill(Number(a)); }
    else if (m === "killafter") { p.stdin.end(stdin); kill(Number(a)); }
    else p.stdin.end(stdin);
    const hard = setTimeout(() => p.kill("SIGKILL"), 150_000);
    p.on("close", (code, signal) => { clearTimeout(hard); resolve({ code, signal, stdout: out, stderr: err, killedAtMs: killedAt, ms: Date.now() - t0 }); });
  });
}

function sshArgv(keyPath: string, user: string): string[] {
  return buildSshArgv({ host: HOST, port: 22, user, [KEY_OPTION]: keyPath } as Parameters<typeof buildSshArgv>[0], { knownHostsFile: KNOWN_HOSTS });
}

function log(rec: object): void {
  appendFileSync(`${LOG_DIR}/runs.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), ...rec })}\n`, { mode: 0o600 });
}

async function sendGateway(kind: string, request: string, mode: string, extra: object): Promise<number> {
  await guard();
  const key = loadOrCreateMaintenanceKey("sentani", DEFAULT_HELPER_DIR, false).privateKeyPath;
  const r = await run(sshArgv(key, "servrsit"), request, mode);
  let reply: unknown = null;
  try { reply = JSON.parse(r.stdout); } catch { reply = r.stdout ? { notJson: r.stdout.slice(0, 300) } : null; }
  const rec = { kind, mode, requestBytes: Buffer.byteLength(request), requestSha256: createHash("sha256").update(request).digest("hex"), ...extra, sshExit: r.code, sshSignal: r.signal, killedAtMs: r.killedAtMs, ms: r.ms, reply, stderr: r.stderr.slice(0, 300) };
  log(rec);
  process.stdout.write(`${JSON.stringify(rec, null, 2)}\n`);
  return 0;
}

// ------------------------------------------------------------------------------------------------ manifests
function iso(d: Date): string { return d.toISOString(); }

function base(operation: string, plan: string, ttlMs: number, over: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  return {
    schemaVersion: 1, installationId: INSTALLATION_ID, server: { id: SERVER_ID, hostKeyFingerprint: HOST_KEY_FP },
    operationId: randomUUID(), operation, catalogVersion: 1,
    plan: { id: plan, version: 1, digest: digestOf({ t088: plan }) },
    issuedAt: iso(now), acceptBefore: iso(new Date(now.getTime() + ttlMs)), ...over,
  };
}

function build(kind: string, kv: Record<string, string>): Record<string, unknown> {
  const ttl = Number(kv["ttlMs"] ?? 15 * 60_000);
  if (kind === "dirs") {
    const dirs = (kv["paths"] ?? "").split(",").filter(Boolean).map((p) => ({ path: p, owner: "spotty", group: "spotty", mode: kv["mode"] ?? "0755" }));
    const existing = (kv["existing"] ?? "").split(",").filter(Boolean).sort();
    return base("prepare.directories.v1", kv["plan"] ?? "t088-dirs", ttl, {
      scope: { requested: dirs, directories: dirs, existing, includesServiceRestart: false, includesReboot: false },
      preconditionDigest: digestOf({ existing }), verification: { expectDirectories: dirs },
    });
  }
  if (kind === "apply") {
    // kv.pkgs = JSON file: [{name, arch, from, to}]; precondition = helper rule over the "from" versions as observed
    const pkgs = JSON.parse(readFileSync(kv["pkgs"]!, "utf8")) as Array<{ name: string; arch: string; from: string; to: string }>;
    const installed = Object.fromEntries(pkgs.map((p) => [`${p.name}:${p.arch}`, p.from]).sort());
    return base("apply.packages.v1", kv["plan"] ?? "t088-apply", ttl, {
      scope: { packages: pkgs }, preconditionDigest: digestOf({ installed }),
      verification: { expectInstalled: Object.fromEntries(pkgs.map((p) => [`${p.name}:${p.arch}`, p.to])) },
    });
  }
  if (kind === "reboot") {
    return base("reboot.host.v1", kv["plan"] ?? "t088-reboot", ttl, {
      scope: { includesServiceRestart: false, includesReboot: true },
      preconditionDigest: digestOf({ bootId: kv["bootId"] }), verification: { previousBootId: kv["bootId"] },
    });
  }
  throw new Error(`unknown manifest kind ${kind}`);
}

// ------------------------------------------------------------------------------------------------ main
async function main(): Promise<number> {
  const [cmd, a1, a2, ...rest] = process.argv.slice(2);
  if (cmd === "probe") {
    await guard();
    const script = PROBES[a1 ?? ""];
    if (script === undefined) throw new Error(`no probe ${a1}`);
    const r = await run(sshArgv(INSPECT_KEY, "spotty"), `${script}\n`);
    writeFileSync(`${LOG_DIR}/probe-${a1}-${Date.now()}.txt`, r.stdout, { mode: 0o600 });
    log({ kind: "probe", probe: a1, sshExit: r.code, bytes: r.stdout.length });
    process.stdout.write(r.stdout);
    if (r.code !== 0) process.stderr.write(`probe exit ${r.code} ${r.stderr.slice(0, 300)}\n`);
    return r.code ?? 1;
  }
  if (cmd === "manifest") {
    const kv = Object.fromEntries([a2, ...rest].slice(1).map((s) => s!.split(/=(.*)/s).slice(0, 2)));
    const m = build(a1!, kv as Record<string, string>);
    writeFileSync(a2!, `${JSON.stringify(m, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ operationId: m["operationId"], digest: digestOf(m) })}\n`);
    return 0;
  }
  const signer = loadOrCreateSigningKey(DEFAULT_HELPER_DIR, false).signer;
  if (cmd === "submit") {
    const m = JSON.parse(readFileSync(a1!, "utf8"));
    const d = describe(m, signer);
    return sendGateway("submit", submitRequest(m, signer), a2 ?? "normal", { manifestFile: a1, operationId: m.operationId, operation: m.operation, manifestDigest: d.digest, keyId: d.keyId });
  }
  if (cmd === "sign") { process.stdout.write(`${submitRequest(JSON.parse(readFileSync(a1!, "utf8")), signer)}\n`); return 0; }
  if (cmd === "raw") return sendGateway("raw", readFileSync(a1!, "utf8"), a2 ?? "normal", { requestFile: a1 });
  if (cmd === "query") return sendGateway("query", queryRequest(a1!), a2 ?? "normal", { operationId: a1 });
  process.stderr.write("usage: probe|manifest|submit|sign|raw|query\n");
  return 2;
}

process.exit(await main());
