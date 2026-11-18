"""Root-owned operation ledger (Technical Spec 8.2, 9.4; invariants 7, 8).

One JSON file per operation id in a root-only directory.

  - claim() is atomic: the file is created with O_CREAT|O_EXCL under an
    exclusive lock. The same id with the same digest returns the existing
    record; the same id with another digest is refused; a second unresolved
    mutation on this server is refused.
  - A finished record is final: it is never changed again.
  - Every write goes to a new temporary file, is fsynced, then renamed over
    the record, and the directory is fsynced. A crash leaves the old or the
    new record, never half of one.
  - Nothing follows symlinks (O_NOFOLLOW, lstat checks).
"""

import contextlib
import fcntl
import json
import os
import stat

from .schema import OPERATION_ID

FINAL = "finished"
MAX_EVIDENCE = 50
MAX_EVIDENCE_TEXT = 300


class LedgerError(Exception):
    pass


class Ledger:
    def __init__(self, directory: str, require_root: bool = True):
        self.directory = directory
        st = os.lstat(directory)
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
            raise LedgerError("ledger directory is not a plain directory")
        if require_root and st.st_uid != 0:
            raise LedgerError("ledger directory is not owned by root")
        if st.st_mode & 0o077:
            raise LedgerError("ledger directory is accessible by group or others")

    def _path(self, operation_id: str) -> str:
        if not OPERATION_ID.fullmatch(operation_id):
            raise LedgerError("invalid operation id")
        return os.path.join(self.directory, operation_id + ".json")

    @contextlib.contextmanager
    def _locked(self):
        fd = os.open(os.path.join(self.directory, ".lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def _fsync_dir(self) -> None:
        fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _read(self, path: str) -> dict | None:
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            return None
        with os.fdopen(fd, "rb") as f:
            return json.loads(f.read().decode("utf-8"))

    def _write_new(self, path: str, record: dict) -> None:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(json.dumps(record, sort_keys=True).encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())

    def _replace(self, path: str, record: dict) -> None:
        tmp = path + ".tmp"
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        self._write_new(tmp, record)
        os.rename(tmp, path)
        self._fsync_dir()

    def get(self, operation_id: str) -> dict | None:
        return self._read(self._path(operation_id))

    def unresolved(self) -> list[str]:
        out = []
        for name in os.listdir(self.directory):
            if not name.endswith(".json"):
                continue
            rec = self._read(os.path.join(self.directory, name))
            if rec is not None and rec.get("state") != FINAL:
                out.append(rec.get("operationId", ""))
        return out

    def claim(self, operation_id: str, digest: str, manifest: dict, now: str) -> tuple[str, dict | None]:
        """('accepted' | 'existing', record) or ('DIGEST_MISMATCH' | 'TARGET_BUSY', None)."""
        path = self._path(operation_id)
        with self._locked():
            existing = self._read(path)
            if existing is not None:
                if existing.get("manifestDigest") == digest:
                    return "existing", existing
                return "DIGEST_MISMATCH", None
            if [o for o in self.unresolved() if o != operation_id]:
                return "TARGET_BUSY", None
            record = {
                "operationId": operation_id,
                "manifestDigest": digest,
                "manifest": manifest,
                "state": "accepted",
                "outcome": None,
                "exitCode": None,
                "acceptedAt": now,
                "startedAt": None,
                "finishedAt": None,
                "evidence": [],
            }
            self._write_new(path, record)
            self._fsync_dir()
            return "accepted", record

    def update(self, operation_id: str, **changes) -> dict:
        path = self._path(operation_id)
        with self._locked():
            current = self._read(path)
            if current is None:
                raise LedgerError("no such operation")
            if current.get("state") == FINAL:
                raise LedgerError("a finished operation is final")
            evidence = changes.pop("evidence", None)
            current.update(changes)
            if evidence is not None:
                current["evidence"] = (current["evidence"] + [str(e)[:MAX_EVIDENCE_TEXT] for e in evidence])[-MAX_EVIDENCE:]
            self._replace(path, current)
            return current
