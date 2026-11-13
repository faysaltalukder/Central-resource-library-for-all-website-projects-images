#!/usr/bin/env python3
"""Safely extract every ZIP in the repository root and build searchable indexes."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import shutil
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import quote

ROOT = Path(".").resolve()
INDEX_DIR = ROOT / "indexes"
STATE_FILE = INDEX_DIR / ".zip-archive-state.json"
CATALOG_FILE = INDEX_DIR / "catalog.json"

MAX_FILES_PER_ARCHIVE = 10_000
MAX_FILE_SIZE = 100 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024
MAX_COMPRESSION_RATIO = 1_000

IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif",
    ".bmp", ".tif", ".tiff", ".ico",
}
VECTOR_EXTENSIONS = {".svg", ".eps", ".ai"}

REPO = os.environ["GITHUB_REPOSITORY"]
REF = os.environ.get("GITHUB_REF_NAME", "main")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slugify(value: str) -> str:
    value = value.casefold().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "archive"


def paths_for_archive(archive: Path, archive_sha: str) -> tuple[Path, Path, str]:
    slug = slugify(archive.stem)

    # Preserve the folder and index already created for the first test archive.
    if archive.name == "Lifestyle Trends and Online Shopping in BD.zip":
        return (
            ROOT / "assets/lifestyle-trends/Lifestyle Trends and Online Shopping in BD",
            INDEX_DIR / "lifestyle-trends.json",
            "lifestyle-trends",
        )

    # A short hash suffix prevents collisions between similarly named ZIPs.
    suffix = archive_sha[:8]
    return (
        ROOT / "assets/zip-archives" / f"{slug}-{suffix}",
        INDEX_DIR / "zip-archives" / f"{slug}-{suffix}.json",
        f"{slug}-{suffix}",
    )


def raw_url(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    return (
        "https://raw.githubusercontent.com/"
        + REPO + "/" + quote(REF, safe="")
        + "/" + quote(relative, safe="/")
    )


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def extract_one(archive: Path, old_state: dict) -> dict:
    archive_sha = sha256_file(archive)
    output_dir, index_file, archive_id = paths_for_archive(archive, archive_sha)
    archive_key = archive.name

    previous = old_state.get(archive_key, {})
    if (
        previous.get("archive_sha256") == archive_sha
        and output_dir.is_dir()
        and index_file.is_file()
    ):
        print(f"UNCHANGED: {archive.name}; keeping existing extraction")
        return previous

    print(f"EXTRACTING: {archive.name}")

    if output_dir.exists():
        if output_dir.is_symlink():
            raise RuntimeError(f"Refusing to replace symlink: {output_dir}")
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    entries = []
    seen_paths = set()
    seen_hashes = {}
    total_uncompressed = 0
    image_count = 0
    vector_count = 0
    duplicate_count = 0

    try:
        with zipfile.ZipFile(archive, "r") as bundle:
            members = [item for item in bundle.infolist() if not item.is_dir()]

            if len(members) > MAX_FILES_PER_ARCHIVE:
                raise RuntimeError(
                    f"{archive.name}: exceeds {MAX_FILES_PER_ARCHIVE} files"
                )

            for item in members:
                name = item.filename.replace("\\", "/")
                relative = PurePosixPath(name)

                if relative.is_absolute() or ".." in relative.parts:
                    raise RuntimeError(f"Unsafe path in ZIP: {name}")

                if not relative.parts:
                    continue
                if "__MACOSX" in relative.parts or relative.name == ".DS_Store":
                    continue

                unix_mode = item.external_attr >> 16
                if stat.S_ISLNK(unix_mode):
                    raise RuntimeError(f"Symbolic link is not allowed: {name}")

                if item.file_size > MAX_FILE_SIZE:
                    raise RuntimeError(f"File too large in ZIP: {name}")

                if item.compress_size > 0:
                    ratio = item.file_size / item.compress_size
                    if ratio > MAX_COMPRESSION_RATIO:
                        raise RuntimeError(f"Suspicious compression ratio: {name}")

                total_uncompressed += item.file_size
                if total_uncompressed > MAX_TOTAL_UNCOMPRESSED:
                    raise RuntimeError(
                        f"{archive.name}: exceeds 1 GiB extracted-size safety limit"
                    )

                target = output_dir.joinpath(*relative.parts)
                if not target.resolve().is_relative_to(output_dir.resolve()):
                    raise RuntimeError(f"Unsafe extraction target: {name}")

                relative_target = target.relative_to(ROOT).as_posix()
                if relative_target in seen_paths:
                    raise RuntimeError(f"Duplicate path in ZIP: {name}")
                seen_paths.add(relative_target)

                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()

                with bundle.open(item, "r") as source, target.open("wb") as dest:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        dest.write(chunk)
                        digest.update(chunk)

                file_hash = digest.hexdigest()
                suffix = target.suffix.lower()
                kind = (
                    "image" if suffix in IMAGE_EXTENSIONS
                    else "vector" if suffix in VECTOR_EXTENSIONS
                    else "other"
                )
                if kind == "image":
                    image_count += 1
                elif kind == "vector":
                    vector_count += 1

                duplicate_of = seen_hashes.get(file_hash)
                if duplicate_of:
                    duplicate_count += 1
                else:
                    seen_hashes[file_hash] = relative_target

                entries.append({
                    "path": relative_target,
                    "filename": target.name,
                    "size": target.stat().st_size,
                    "sha256": file_hash,
                    "kind": kind,
                    "content_type": mimetypes.guess_type(target.name)[0],
                    "duplicate_of": duplicate_of,
                    "url": raw_url(target),
                })

    except Exception:
        # Do not leave a half-extracted directory after a failed archive.
        shutil.rmtree(output_dir, ignore_errors=True)
        raise

    index_file.parent.mkdir(parents=True, exist_ok=True)
    index_file.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    record = {
        "archive": archive.name,
        "archive_path": archive.relative_to(ROOT).as_posix(),
        "archive_sha256": archive_sha,
        "archive_size": archive.stat().st_size,
        "archive_url": raw_url(archive),
        "archive_id": archive_id,
        "output_directory": output_dir.relative_to(ROOT).as_posix(),
        "index_path": index_file.relative_to(ROOT).as_posix(),
        "total_files": len(entries),
        "image_files": image_count,
        "vector_files": vector_count,
        "other_files": len(entries) - image_count - vector_count,
        "duplicate_copies": duplicate_count,
        "extracted_size": total_uncompressed,
    }

    print(
        f"DONE: {archive.name}: {len(entries)} files "
        f"({image_count} images, {vector_count} vectors, "
        f"{duplicate_count} duplicate copies)"
    )
    return record


def main() -> int:
    archives = sorted(
        path for path in ROOT.glob("*.zip")
        if path.is_file() and not path.is_symlink()
    )
    if not archives:
        print("No ZIP files found in the repository root.")
        return 0

    state = load_state()
    new_state = {}
    records = []

    for archive in archives:
        record = extract_one(archive, state)
        new_state[archive.name] = record
        records.append(record)

    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(
        json.dumps(new_state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    catalog = {
        "repository": REPO,
        "branch": REF,
        "archive_count": len(records),
        "archives": records,
    }
    CATALOG_FILE.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"CATALOG: {CATALOG_FILE.relative_to(ROOT)}")
    print(f"PROCESSED ARCHIVES: {len(records)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (zipfile.BadZipFile, RuntimeError, OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
