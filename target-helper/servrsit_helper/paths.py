"""Directory creation without symlink races (Technical Spec 8.3).

Every component is opened relative to its parent's file descriptor with
O_NOFOLLOW|O_DIRECTORY, so a symlink anywhere on the path is refused, and a
swap between check and use cannot redirect the work. Only the last
component is ever created. Nothing existing is changed: an existing path is
reported and left exactly as it is. Mode and owner are set on the new
directory's own descriptor (fchmod/fchown), so the umask cannot change them.
"""

import os
import stat


class PathRefused(Exception):
    """A fixed reason the path was not created."""


def _open_dir(name: str, dir_fd: int) -> int:
    try:
        return os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dir_fd)
    except FileNotFoundError:
        raise PathRefused("a parent directory is missing")
    except (NotADirectoryError, OSError) as e:
        # ELOOP (symlink) and ENOTDIR both land here.
        raise PathRefused("a path component is a symlink or not a directory") from e


def exists_nofollow(root: str, path: str) -> bool:
    """True if anything exists at `path` (inside `root`), without following symlinks."""
    try:
        os.lstat(os.path.join(root, path.lstrip("/")))
        return True
    except FileNotFoundError:
        return False


def create_directory(root: str, path: str, uid: int, gid: int, mode: int) -> str:
    """Create `path` under `root`. Returns 'created' or 'existing'. Raises PathRefused."""
    parts = path.strip("/").split("/")
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in parts[:-1]:
            nxt = _open_dir(part, fd)
            os.close(fd)
            fd = nxt
        last = parts[-1]
        try:
            st = os.stat(last, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISLNK(st.st_mode):
                raise PathRefused("the path is a symlink")
            return "existing"
        except FileNotFoundError:
            pass
        try:
            os.mkdir(last, 0o700, dir_fd=fd)
        except FileExistsError:
            # Created by someone else between the check and now: leave it alone.
            return "existing"
        new = _open_dir(last, fd)
        try:
            # T-084 (D-H6): emptiness by listing, not by link count (btrfs reports nlink 1 for directories).
            if os.listdir(new):
                raise PathRefused("the new directory is not empty")
            os.fchown(new, uid, gid)
            os.fchmod(new, mode)
        finally:
            os.close(new)
        return "created"
    finally:
        os.close(fd)
