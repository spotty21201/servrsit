"""T-091 (D-S3): the root step of the helper install, made on Merauke.

The folder copied to the server lives in the owner's home, where the
owner's account (and, before T-091, the inspect key) can change files. So
root never runs anything from it directly. Instead the founder runs ONE
printed command that:

  1. makes a fresh root-only directory (mktemp -d /root/servrsit-install.XXXXXX, 0700);
  2. copies root-step.sh into it and checks its SHA-256 against the value
     printed on Merauke;
  3. runs that copy, which copies every other file into the same directory,
     checks each copy's SHA-256 (the values are written inside root-step.sh,
     so they too come from Merauke), and only then runs bootstrap.sh or
     uninstall.sh from the root-owned copies.

Nothing in the owner's home is trusted after it was copied. A file that is
missing, a symlink, or different stops everything before any step runs.

    python3 root_step.py <stage-dir> <folder-on-server> <account> <installation-id> \
        <home-user> <from> <maintenance-public-line>

writes <stage-dir>/root-step.sh and prints one JSON object: its SHA-256 and
the three commands to print for the founder.
"""

import hashlib
import json
import os
import re
import sys

ROOT_PREFIX = "/root/servrsit-install."
SAFE_PATH = re.compile(r"^/[A-Za-z0-9._/-]{1,200}$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
ACCOUNT = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
INSTALLATION_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
FROM = re.compile(r"^[A-Za-z0-9.:-]{1,253}$")
PUBLIC_LINE = re.compile(r"^ssh-ed25519 [A-Za-z0-9+/]+={0,2} servrsit-maintenance-[a-z0-9-]+$")
MODES = ("dry-run", "install", "uninstall")


def _check(value: str, pattern: re.Pattern, what: str) -> str:
    if not pattern.match(value) or ".." in value.split("/"):
        raise ValueError("%s is not valid: %r" % (what, value))
    return value


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def render(stage: str, src: str, account: str, installation_id: str, home_user: str, from_: str, public_line: str,
           root_prefix: str = ROOT_PREFIX) -> str:
    """The text of root-step.sh for the files now in `stage` (root-step.sh itself excluded)."""
    _check(src, SAFE_PATH, "the folder on the server")
    _check(root_prefix, SAFE_PATH, "the root directory prefix")
    _check(account, ACCOUNT, "the account")
    _check(home_user, ACCOUNT, "the home user")
    _check(installation_id, INSTALLATION_ID, "the installation id")
    _check(from_, FROM, "the from address")
    if not PUBLIC_LINE.match(public_line):
        raise ValueError("the maintenance public key line is not valid")
    names = sorted(n for n in os.listdir(stage) if n != "root-step.sh")
    for n in names:
        _check(n, SAFE_NAME, "file name")
        if os.path.islink(os.path.join(stage, n)) or not os.path.isfile(os.path.join(stage, n)):
            raise ValueError("%s is not a plain file" % n)
    packages = [n for n in names if n.startswith("servrsit-helper-") and n.endswith(".tar.gz")]
    if len(packages) != 1 or "bootstrap.sh" not in names or "uninstall.sh" not in names or "trust.json" not in names:
        raise ValueError("the stage must hold one package, bootstrap.sh, uninstall.sh and trust.json")
    package = packages[0]
    sums = "\n".join("%s  %s" % (sha256_file(os.path.join(stage, n)), n) for n in names)
    bootstrap = (
        "sh ./bootstrap.sh --package %s --sha256 %s --installation-id %s --trust trust.json --account %s "
        "--create-account --home-user %s --install-deps --from %s --authorized-key \"%s\""
        % (package, sha256_file(os.path.join(stage, package)), installation_id, account, home_user, from_, public_line)
    )
    return "\n".join([
        "#!/bin/sh",
        "# ServrSit helper: ROOT STEP (T-091). Made on Merauke. Run only through the printed command,",
        "# which checks this file's SHA-256 first. It copies every file below into its own root-only",
        "# directory, checks each copy's SHA-256, and only then runs bootstrap.sh or uninstall.sh.",
        "set -eu",
        "umask 077",
        "SRC='%s'" % src,
        'D=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
        'MODE=${1:-}',
        'case $MODE in dry-run|install|uninstall) ;; *) echo "usage: sh root-step.sh dry-run|install|uninstall" >&2; exit 2 ;; esac',
        '[ "$(id -u)" -eq 0 ] || { echo "run this as root (sudo)" >&2; exit 1; }',
        'case $D in %s*) ;; *) echo "root-step.sh runs only from its copy in %s* (use the printed command)" >&2; exit 1 ;; esac' % (root_prefix, root_prefix),
        "for f in %s; do" % " ".join(names),
        '  if [ -L "$SRC/$f" ] || [ ! -f "$SRC/$f" ]; then echo "$SRC/$f is missing or not a plain file; nothing was run" >&2; exit 1; fi',
        '  install -m 0600 "$SRC/$f" "$D/$f"',
        "done",
        'cd "$D"',
        "if ! sha256sum --check --strict --quiet <<'SUMS'",
        sums,
        "SUMS",
        'then echo "a file differs from the SHA-256 printed on Merauke; nothing was run" >&2; exit 1; fi',
        'echo "all %d files match the SHA-256 values made on Merauke; running from $D"' % len(names),
        "case $MODE in",
        "  dry-run) %s --dry-run ;;" % bootstrap,
        "  install) %s ;;" % bootstrap,
        "  uninstall) sh ./uninstall.sh --account %s ;;" % account,
        "esac",
        "",
    ])


def founder_command(src: str, digest: str, mode: str, root_prefix: str = ROOT_PREFIX) -> str:
    """The one command the founder runs. It trusts nothing in `src` except a file with this SHA-256."""
    if mode not in MODES or not re.match(r"^[0-9a-f]{64}$", digest):
        raise ValueError("bad mode or digest")
    _check(src, SAFE_PATH, "the folder on the server")
    return (
        "sudo sh -c 'D=$(mktemp -d %sXXXXXX) && install -m 600 %s/root-step.sh \"$D\"/ && "
        "echo \"%s  $D/root-step.sh\" | sha256sum -c --quiet && sh \"$D\"/root-step.sh %s'"
        % (root_prefix, src, digest, mode)
    )


def main(argv: list[str]) -> int:
    if len(argv) != 8:
        sys.stderr.write(__doc__)
        return 2
    stage, src, account, installation_id, home_user, from_, public_line = argv[1:]
    text = render(stage, src, account, installation_id, home_user, from_, public_line)
    path = os.path.join(stage, "root-step.sh")
    with open(path, "w", encoding="ascii") as f:
        f.write(text)
    os.chmod(path, 0o644)
    digest = sha256_file(path)
    print(json.dumps({"sha256": digest, "commands": {m: founder_command(src, digest, m) for m in MODES}}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
