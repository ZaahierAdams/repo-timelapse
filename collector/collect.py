#!/usr/bin/env python3
"""
Repo Timelapse collector.

Walks the full git history of every repo and produces a daily time series of:
  - commits   (non-merge commits on any branch, by author date)
  - loc       (lines in source-code files on the default branch, generated/vendored files excluded)
  - size      (bytes of all tracked files on the default branch)
  - langs     (loc split by language)

Usage:
  python collect.py --clones DIR [--repos-json FILE] --out stats.json
  python collect.py --clones DIR --fetch --owner NAME --out stats.json   (needs GH_TOKEN)

Nothing here prints repository names unless --verbose is passed, so CI logs stay clean.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo(os.environ.get("TIMELAPSE_TZ", "Africa/Johannesburg"))

# ---------------------------------------------------------------- classification
LANGS = {
    ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
    ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".py": "Python", ".cs": "C#", ".dart": "Dart", ".kt": "Kotlin", ".kts": "Kotlin",
    ".java": "Java", ".swift": "Swift", ".m": "Objective-C", ".mm": "Objective-C",
    ".html": "HTML", ".htm": "HTML", ".css": "CSS", ".scss": "CSS", ".sass": "CSS", ".less": "CSS",
    ".sql": "SQL", ".sh": "Shell", ".bash": "Shell", ".ps1": "PowerShell",
    ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
    ".go": "Go", ".rs": "Rust", ".php": "PHP", ".rb": "Ruby",
    ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++",
    ".glsl": "Shaders", ".frag": "Shaders", ".vert": "Shaders", ".wgsl": "Shaders",
    ".gd": "GDScript", ".lua": "Lua", ".r": "R", ".ipynb": None,  # notebooks are JSON blobs
}
EXCLUDED_DIRS = {
    "node_modules", "dist", "build", "out", ".next", ".nuxt", ".expo", ".output", "coverage",
    ".dart_tool", "Pods", "vendor", ".gradle", "__pycache__", ".venv", "venv", "env",
    "target", "bin", "obj", "Library", "Temp", "Logs", ".vercel", ".svelte-kit", ".turbo",
    "generated", "__generated__", ".cache", "public/build", "www", "platforms",
}
SCRATCH_DIRS = {"_to_delete", "to_delete", "tmp", "temp", "claude outputs", "_archive", "archive"}
EXCLUDED_FILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "pubspec.lock",
    "Podfile.lock", "composer.lock", "Cargo.lock", "poetry.lock", "Gemfile.lock",
}
EXCLUDED_SUFFIXES = (
    ".min.js", ".min.css", ".map", ".g.dart", ".freezed.dart", ".pb.go", ".bundle.js",
    ".chunk.js", "-lock.json",
)


def language_of(path: str) -> str | None:
    parts = path.split("/")
    name = parts[-1]
    if name in EXCLUDED_FILES or name.endswith(EXCLUDED_SUFFIXES):
        return None
    for p in parts[:-1]:
        # vendored/build output, hidden folders (.tmp-assets, browser profiles…), scratch folders
        if p in EXCLUDED_DIRS or p.startswith(".") or p.lower() in SCRATCH_DIRS:
            return None
    dot = name.rfind(".")
    if dot <= 0:
        return None
    return LANGS.get(name[dot:].lower())


# ---------------------------------------------------------------- git helpers
def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    ).stdout


def local_day(iso: str) -> str:
    return dt.datetime.fromisoformat(iso).astimezone(TZ).date().isoformat()


def default_branch(repo: Path, hint: str | None) -> tuple[str, str] | None:
    """Return (branch name, git ref) for the default branch, in a bare clone or a CI checkout."""
    def ok(ref: str) -> bool:
        try:
            git(repo, "rev-parse", "--verify", "--quiet", ref)
            return True
        except subprocess.CalledProcessError:
            return False
    if hint:
        for ref in (f"refs/remotes/origin/{hint}", f"refs/heads/{hint}"):
            if ok(ref):
                return hint, ref
    try:
        ref = git(repo, "symbolic-ref", "HEAD").strip()
        if ok(ref):
            return ref.removeprefix("refs/heads/"), ref
    except subprocess.CalledProcessError:
        pass
    heads = git(repo, "for-each-ref", "--format=%(refname)", "refs/heads").split()
    return (heads[0].removeprefix("refs/heads/"), heads[0]) if heads else None


def commits_per_day(repo: Path) -> dict[str, int]:
    out = git(repo, "log", "--all", "--no-merges", "--format=%H\t%aI")
    seen, per_day = set(), defaultdict(int)
    for line in out.splitlines():
        h, _, iso = line.partition("\t")
        if h in seen or not iso:
            continue
        seen.add(h)
        per_day[local_day(iso)] += 1
    return per_day


def snapshots(repo: Path, branch: str):
    out = git(
        repo, "log", branch, "--first-parent", "--reverse", "--no-renames",
        "--diff-merges=first-parent", "--numstat", "--format=@@%H\t%cI",
    )
    langs: dict[str, int] = defaultdict(int)
    result: dict[str, dict] = {}
    cur_day = None

    def close_day():
        if cur_day is not None:
            result[cur_day]["langs"] = {k: v for k, v in langs.items() if v > 0}
            result[cur_day]["loc"] = sum(result[cur_day]["langs"].values())

    for line in out.splitlines():
        if line.startswith("@@"):
            sha, _, iso = line[2:].partition("\t")
            day = local_day(iso)
            if cur_day is not None and day < cur_day:
                day = cur_day
            if day != cur_day:
                close_day()
                cur_day = day
                result.setdefault(day, {"add": 0, "del": 0})
            result[day]["sha"] = sha
            continue
        if not line.strip() or cur_day is None:
            continue
        a, r, path = line.split("\t", 2)
        if a == "-":
            continue
        lang = language_of(path)
        if not lang:
            continue
        a, r = int(a), int(r)
        langs[lang] += a - r
        result[cur_day]["add"] += a
        result[cur_day]["del"] += r
    close_day()
    return result


def tree_size(repo: Path, sha: str) -> int:
    total = 0
    for line in git(repo, "ls-tree", "-r", "-l", sha).splitlines():
        meta = line.split("\t", 1)[0].split()
        if len(meta) == 4 and meta[1] == "blob" and meta[3] != "-":
            total += int(meta[3])
    return total


def tags(repo: Path) -> list[dict]:
    out = git(repo, "for-each-ref", "refs/tags", "--format=%(refname:short)\t%(creatordate:iso-strict)")
    res = []
    for line in out.splitlines():
        name, _, iso = line.partition("\t")
        if iso:
            res.append({"name": name, "d": local_day(iso)})
    return res


def collect_repo(repo: Path, meta: dict) -> dict | None:
    found = default_branch(repo, meta.get("default_branch"))
    if not found:
        return None
    branch, ref = found
    cpd = commits_per_day(repo)
    snaps = snapshots(repo, ref)
    days = sorted(set(cpd) | set(snaps))
    if not days:
        return None
    series = []
    last_loc, last_size, last_langs = 0, 0, {}
    for d in days:
        s = snaps.get(d)
        if s:
            last_loc = s["loc"]
            last_langs = s["langs"]
            last_size = tree_size(repo, s["sha"])
        series.append({
            "d": d,
            "c": cpd.get(d, 0),
            "a": s["add"] if s else 0,
            "r": s["del"] if s else 0,
            "loc": last_loc,
            "size": last_size,
            "langs": last_langs if s else None,  # only emitted when it changed
        })
    for row in series:
        if row["langs"] is None:
            del row["langs"]
    return {
        "name": meta["name"],
        "private": meta.get("private", True),
        "language": meta.get("language"),
        "description": meta.get("description"),
        "created_at": meta.get("created_at"),
        "pushed_at": meta.get("pushed_at"),
        "archived": meta.get("archived", False),
        "default_branch": branch,
        "first_day": days[0],
        "total_commits": sum(cpd.values()),
        "series": series,
        "tags": tags(repo),
    }


# ---------------------------------------------------------------- GitHub
def gh_get(url: str, token: str):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "repo-timelapse",
    })
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def list_repos(token: str, owner: str) -> list[dict]:
    repos, page = [], 1
    while True:
        batch = gh_get(f"https://api.github.com/user/repos?affiliation=owner&per_page=100&page={page}", token)
        repos += batch
        if len(batch) < 100:
            break
        page += 1
    keep = []
    for r in repos:
        if r["owner"]["login"].lower() != owner.lower() or r.get("fork"):
            continue
        keep.append({k: r.get(k) for k in (
            "name", "private", "language", "description", "created_at", "pushed_at",
            "archived", "default_branch", "size")})
    return keep


def sync_clone(clones: Path, owner: str, name: str, token: str) -> Path:
    dest = clones / f"{name}.git"
    url = f"https://x-access-token:{token}@github.com/{owner}/{name}.git"
    if dest.exists():
        subprocess.run(["git", "-C", str(dest), "fetch", "--quiet", "--prune", "--tags", url,
                        "+refs/heads/*:refs/heads/*"], check=True, capture_output=True)
    else:
        subprocess.run(["git", "clone", "--bare", "--quiet", url, str(dest)], check=True, capture_output=True)
    return dest


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clones", type=Path, help="folder of bare clones named <repo>.git")
    ap.add_argument("--single", type=Path, help="collect one checked-out repo (CI mode)")
    ap.add_argument("--meta-json", type=Path, help="GitHub repo metadata for --single")
    ap.add_argument("--repos-json", type=Path, help="metadata list (as returned by GitHub)")
    ap.add_argument("--fetch", action="store_true", help="list + clone/fetch repos via GH_TOKEN")
    ap.add_argument("--owner", default=os.environ.get("GITHUB_REPOSITORY_OWNER", ""))
    ap.add_argument("--exclude", default=os.environ.get("TIMELAPSE_EXCLUDE", ""),
                    help="comma-separated repo names to skip")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if args.single:
        meta = json.loads(args.meta_json.read_text()) if args.meta_json else {"name": args.single.name}
        meta = {k: meta.get(k) for k in (
            "name", "private", "language", "description", "created_at", "pushed_at", "archived", "default_branch")}
        res = collect_repo(args.single, meta)
        args.out.write_text(json.dumps({
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "tz": str(TZ), "repo": res,
        }, separators=(",", ":")))
        print("collected" if res else "no history on the default branch", file=sys.stderr)
        return 0

    if not args.clones:
        ap.error("--clones or --single is required")
    args.clones.mkdir(parents=True, exist_ok=True)
    excluded = {x.strip().lower() for x in args.exclude.split(",") if x.strip()}

    if args.fetch:
        token = os.environ["GH_TOKEN"]
        metas = list_repos(token, args.owner)
    elif args.repos_json:
        metas = json.loads(args.repos_json.read_text())
    else:
        metas = [{"name": p.name.removesuffix(".git")} for p in sorted(args.clones.glob("*.git"))]

    out_repos, failed = [], 0
    for i, meta in enumerate(metas, 1):
        if meta["name"].lower() in excluded or meta.get("size") == 0:
            continue
        label = meta["name"] if args.verbose else f"repo {i}/{len(metas)}"
        try:
            path = (sync_clone(args.clones, args.owner, meta["name"], os.environ["GH_TOKEN"])
                    if args.fetch else args.clones / f"{meta['name']}.git")
            res = collect_repo(path, meta)
            if res:
                out_repos.append(res)
            print(f"ok   {label}", file=sys.stderr)
        except Exception as e:  # keep going; one bad repo shouldn't kill the run
            failed += 1
            print(f"FAIL {label}: {type(e).__name__}", file=sys.stderr)

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "tz": str(TZ),
        "owner": args.owner,
        "repos": sorted(out_repos, key=lambda r: r["first_day"]),
    }
    args.out.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(out_repos)} repos collected, {failed} failed", file=sys.stderr)
    return 1 if failed and not out_repos else 0


if __name__ == "__main__":
    sys.exit(main())
