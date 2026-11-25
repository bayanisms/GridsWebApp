"""Build and inspect a source-only GitHub upload without local Git metadata."""

from pathlib import Path
import re
import socket
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "release" / "GridsWebApp-source.zip"
ROOT_FILES = {
    ".gitattributes", ".gitignore", "README.md", "THIRD_PARTY.md",
    "eslint.config.js", "index.html", "package.json", "package-lock.json",
    "tsconfig.app.json", "tsconfig.json", "tsconfig.node.json", "vite.config.ts",
}
DIRECTORIES = {"src", "public", "scripts", "grids", ".github"}
# CAD files are optional upstream design references, not web app source.
EXCLUDED_PARTS = {"hardware_design", "__pycache__", ".git", "node_modules"}
RULES = {
    "user-specific filesystem path": rb"/(?:home|Users)/[^\s\"'<>]+|[A-Za-z]:\\Users\\",
    "private-network address": rb"\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b",
    "credential": rb"AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{32,}",
    "URL containing credentials": rb"https?://[^\s/@:]+:[^\s/@]+@",
}


def source_paths():
    for name in sorted(ROOT_FILES):
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Missing or linked source file: {name}")
        yield path
    for directory in sorted(DIRECTORIES):
        for path in sorted((ROOT / directory).rglob("*")):
            relative = path.relative_to(ROOT)
            if EXCLUDED_PARTS.intersection(relative.parts):
                continue
            if path.is_symlink():
                raise ValueError(f"Source symlink must be reviewed: {relative}")
            if path.is_file():
                # Ignore temporary/editor/credential files inside source folders too.
                if path.name.startswith(".") or path.suffix in {".pyc", ".log", ".key", ".pem", ".p12", ".pfx"}:
                    raise ValueError(f"Unexpected local file in source directory: {relative}")
                yield path


def inspect_content(name, data):
    # Check ASCII strings and UTF-16 metadata found in binary formats.
    variants = [data]
    for encoding in ("utf-16-le", "utf-16-be"):
        variants.append(data.decode(encoding, errors="ignore").encode("utf-8"))
    for label, pattern in RULES.items():
        if any(re.search(pattern, variant) for variant in variants):
            raise ValueError(f"Upload blocked: {label} in {name}")
    # Detect this checkout's actual path and computer name without putting them
    # in the distributable source or diagnostic output.
    local_values = [str(ROOT), str(Path.home()), socket.gethostname()]
    for value in local_values:
        if len(value) >= 6 and any(value.encode() in variant for variant in variants):
            raise ValueError(f"Upload blocked: local machine identifier in {name}")


def main():
    entries = []
    for path in source_paths():
        name = path.relative_to(ROOT).as_posix()
        data = path.read_bytes()
        inspect_content(name, data)
        entries.append((name, data))
    OUTPUT.parent.mkdir(exist_ok=True)
    # Fresh ZIP metadata contains no owner IDs, local timestamps or absolute paths.
    temporary = OUTPUT.with_suffix(".tmp")
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries:
                info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
                info.create_system = 0
                info.external_attr = 0x20
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
        with zipfile.ZipFile(temporary) as archive:
            assert archive.testzip() is None
            for info in archive.infolist():
                assert not info.filename.startswith("/") and ".." not in Path(info.filename).parts
                assert not info.extra and not info.comment
                inspect_content(info.filename, archive.read(info))
        temporary.replace(OUTPUT)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Privacy scan passed for {len(entries)} source files.")
    print("Created release/GridsWebApp-source.zip (no Git history or local tool state).")


if __name__ == "__main__":
    main()
