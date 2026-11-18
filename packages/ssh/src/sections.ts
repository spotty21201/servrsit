/**
 * The complete, fixed list of commands the collector runs.
 * Adding an entry here is a reviewed change. Every command is read-only.
 * `$T` expands to `timeout 15` when `timeout` exists, otherwise to nothing.
 */

export interface CollectorSection {
  readonly name: string;
  readonly command: string;
}

export const COLLECTOR_SECTIONS: readonly CollectorSection[] = [
  // First, so it runs as close as possible to the start of the collection (T-061).
  { name: "clock", command: "date +%s" },
  { name: "hostname", command: "uname -n" },
  { name: "os", command: "cat /etc/os-release" },
  { name: "arch", command: "uname -m" },
  { name: "bootid", command: "cat /proc/sys/kernel/random/boot_id" },
  // T-056: part of the machine's identity (with the host key). Read-only.
  { name: "machineid", command: "cat /etc/machine-id" },
  { name: "uptime", command: "cat /proc/uptime" },
  { name: "load", command: "cat /proc/loadavg" },
  { name: "nproc", command: "nproc" },
  { name: "meminfo", command: "cat /proc/meminfo" },
  {
    name: "df",
    command: "$T df -P -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs",
  },
  {
    name: "dfi",
    command: "$T df -Pi -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs",
  },
  {
    name: "failed",
    command: "$T systemctl --failed --no-legend --plain --no-pager",
  },
  {
    name: "apt",
    command: "$T apt-get -s -o Debug::NoLocking=1 upgrade",
  },
  {
    name: "aptstamp",
    command: "stat -c %Y /var/lib/apt/periodic/update-success-stamp",
  },
  { name: "rebootreq", command: "test -e /var/run/reboot-required" },
] as const;

export const SECTION_NAMES: readonly string[] = COLLECTOR_SECTIONS.map((s) => s.name);
