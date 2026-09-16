#!/usr/bin/env python3
"""Discover TestFlight Test Information fields from an app repository."""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import re
import sys
from pathlib import Path
from typing import Any

SKIP_DIR_NAMES = {
    ".git",
    ".yarn",
    ".build",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "Pods",
    "Carthage",
    "vendor",
    "DerivedData",
    "xcuserdata",
}

SKIP_DIR_SUFFIXES = ("Tests", "UITests")

CONFIG_CANDIDATES = (
    ".apple-actions/test-information.json",
    "test-information.json",
)

FIELD_NAMES = (
    "bundleId",
    "locale",
    "description",
    "feedbackEmail",
    "marketingUrl",
    "privacyPolicyUrl",
)

PBX_BUNDLE_ID = re.compile(r"PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);")
XCCONFIG_BUNDLE_ID = re.compile(
    r"^\s*PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^\s;]+)", re.MULTILINE
)
MAILTO_RE = re.compile(
    r"mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})", re.IGNORECASE
)
SUPPORT_EMAIL_RE = re.compile(
    r"\b((?:support|feedback|help|ios-support)@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b",
    re.IGNORECASE,
)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

PLACEHOLDER_EMAIL_DOMAINS = {
    "example.com",
    "example.org",
    "example.net",
    "infinite.red",
    "sentry.io",
}

EMAIL_FILE_SUFFIXES = {
    ".swift",
    ".m",
    ".mm",
    ".h",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".kt",
    ".java",
    ".xml",
    ".plist",
    ".md",
    ".html",
    ".json",
}

SKIP_EMAIL_FILENAMES = {
    "package-lock.json",
    "yarn.lock",
    "Contents.json",
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Discover TestFlight Test Information from a repo."
    )
    parser.add_argument("--dir", default=".", help="App repo to scan")
    parser.add_argument("--config", help="JSON config file")
    parser.add_argument("--bundle-id")
    parser.add_argument("--locale")
    parser.add_argument("--description")
    parser.add_argument("--feedback-email")
    parser.add_argument("--marketing-url")
    parser.add_argument("--privacy-policy-url")
    args = parser.parse_args()

    try:
        discovered = discover(
            Path(args.dir).resolve(),
            overrides={
                "bundleId": args.bundle_id,
                "locale": args.locale,
                "description": args.description,
                "feedbackEmail": args.feedback_email,
                "marketingUrl": args.marketing_url,
                "privacyPolicyUrl": args.privacy_policy_url,
            },
            config_path=Path(args.config).resolve() if args.config else None,
        )
    except (OSError, RuntimeError, ValueError) as err:
        print(str(err), file=sys.stderr)
        return 1

    json.dump(discovered, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


def discover(
    directory: Path,
    overrides: dict[str, str | None],
    config_path: Path | None = None,
) -> dict[str, Any]:
    target: dict[str, Any] = {
        "sources": {},
        "bundleIdCandidates": {},
    }

    apply_info_plists(directory, target)
    apply_xcconfig(directory, target)
    apply_pbxproj(directory, target)
    apply_preferred_bundle_id(target)
    apply_package_json(directory, target)
    apply_expo_config(directory, target)
    apply_readme(directory, target)
    apply_support_emails(directory, target)
    apply_config_file(directory, target, config_path)
    apply_fields(target, overrides, "cli")

    if not target.get("locale"):
        target["locale"] = "en-US"
        target["sources"]["locale"] = "default"
    else:
        target["locale"] = normalize_locale(str(target["locale"]))

    bundle_id = as_trimmed(target.get("bundleId"))
    description = as_trimmed(target.get("description"))
    feedback_email = as_trimmed(target.get("feedbackEmail"))

    if not bundle_id or not description or not feedback_email:
        missing = [
            name
            for name, value in (
                ("bundleId", bundle_id),
                ("description", description),
                ("feedbackEmail", feedback_email),
            )
            if not value
        ]
        extra = ""
        app_candidates = app_bundle_id_candidates(target["bundleIdCandidates"])
        if not target.get("bundleId") and len(app_candidates) > 1:
            extra = (
                f"\nMultiple bundle ids found ({', '.join(app_candidates)}). "
                "Set bundleId in the config file or pass --bundle-id."
            )
        example_bundle = (
            bundle_id
            or next(iter(app_candidates), None)
            or "com.example.app"
        )
        config_example = json.dumps(
            {
                "bundleId": example_bundle,
                "locale": target.get("locale") or "en-US",
                "description": description
                or "What testers should know about this beta.",
                "feedbackEmail": feedback_email or "feedback@example.com",
            },
            indent=2,
        )
        raise RuntimeError(
            f"Could not find TestFlight Test Information in {directory} "
            f"(missing: {', '.join(missing)}).{extra}\n"
            f"Add {directory / '.apple-actions' / 'test-information.json'} with:\n"
            f"{config_example}"
        )

    result = {
        "bundleId": bundle_id,
        "locale": target["locale"],
        "description": description,
        "feedbackEmail": feedback_email,
        "sources": target["sources"],
    }
    marketing_url = as_trimmed(target.get("marketingUrl"))
    privacy_policy_url = as_trimmed(target.get("privacyPolicyUrl"))
    if marketing_url:
        result["marketingUrl"] = marketing_url
    if privacy_policy_url:
        result["privacyPolicyUrl"] = privacy_policy_url
    return result


def normalize_locale(locale: str) -> str:
    trimmed = locale.strip().replace("_", "-")
    if trimmed.lower() == "en":
        return "en-US"
    return trimmed


def apply_fields(
    target: dict[str, Any], fields: dict[str, str | None], source: str
) -> None:
    for key in FIELD_NAMES:
        value = as_trimmed(fields.get(key))
        if value:
            target[key] = value
            target["sources"][key] = source


def apply_fields_if_absent(
    target: dict[str, Any], fields: dict[str, str | None], source: str
) -> None:
    absent = {
        key: value for key, value in fields.items() if not target.get(key)
    }
    apply_fields(target, absent, source)


def remember_bundle_id(target: dict[str, Any], bundle_id: str, source: str) -> None:
    if is_test_bundle_id(bundle_id):
        return
    candidates: dict[str, str] = target["bundleIdCandidates"]
    if bundle_id not in candidates:
        candidates[bundle_id] = source


def apply_preferred_bundle_id(target: dict[str, Any]) -> None:
    if target.get("bundleId"):
        return
    chosen = pick_preferred_bundle_id(target["bundleIdCandidates"])
    if chosen is None:
        return
    bundle_id, source = chosen
    apply_fields(target, {"bundleId": bundle_id}, source)


def pick_preferred_bundle_id(
    candidates: dict[str, str],
) -> tuple[str, str] | None:
    app_candidates = app_bundle_id_candidates(candidates)
    if len(app_candidates) == 1:
        bundle_id, source = next(iter(app_candidates.items()))
        return bundle_id, source

    xcconfig = {
        bundle_id: source
        for bundle_id, source in app_candidates.items()
        if source.endswith(".xcconfig")
    }
    if len(xcconfig) == 1:
        bundle_id, source = next(iter(xcconfig.items()))
        return bundle_id, source

    shared = {
        bundle_id: source
        for bundle_id, source in xcconfig.items()
        if source.endswith("Shared.xcconfig")
    }
    if len(shared) == 1:
        bundle_id, source = next(iter(shared.items()))
        return bundle_id, source
    return None


def app_bundle_id_candidates(candidates: dict[str, str]) -> dict[str, str]:
    return {
        bundle_id: source
        for bundle_id, source in candidates.items()
        if not is_test_bundle_id(bundle_id)
    }


def is_test_bundle_id(bundle_id: str) -> bool:
    last = bundle_id.rsplit(".", 1)[-1].lower()
    return last in {"tests", "uitests", "test"}


def apply_config_file(
    directory: Path, target: dict[str, Any], config_path: Path | None
) -> None:
    candidates = (
        [config_path]
        if config_path is not None
        else [directory / rel for rel in CONFIG_CANDIDATES]
    )
    for candidate in candidates:
        if candidate is None:
            continue
        parsed = read_json_if_present(candidate)
        if not isinstance(parsed, dict):
            continue
        apply_fields(
            target,
            {
                "bundleId": as_string(parsed.get("bundleId")),
                "locale": as_string(parsed.get("locale")),
                "description": as_string(parsed.get("description")),
                "feedbackEmail": as_string(parsed.get("feedbackEmail")),
                "marketingUrl": as_string(parsed.get("marketingUrl")),
                "privacyPolicyUrl": as_string(parsed.get("privacyPolicyUrl")),
            },
            os.path.relpath(candidate, directory),
        )
        return


def apply_expo_config(directory: Path, target: dict[str, Any]) -> None:
    for name in ("app.json", "app.config.json"):
        parsed = read_json_if_present(directory / name)
        if not isinstance(parsed, dict):
            continue
        expo = parsed.get("expo") if isinstance(parsed.get("expo"), dict) else parsed
        ios = expo.get("ios") if isinstance(expo.get("ios"), dict) else {}
        apply_fields(
            target,
            {
                "bundleId": as_string(ios.get("bundleIdentifier")),
                "description": as_string(expo.get("description")),
            },
            name,
        )
        display_name = (
            as_string(expo.get("name"))
            or as_string(parsed.get("displayName"))
            or as_string(parsed.get("name"))
        )
        if display_name:
            apply_fields_if_absent(
                target, {"description": f"Beta of {display_name}."}, name
            )


def apply_package_json(directory: Path, target: dict[str, Any]) -> None:
    parsed = read_json_if_present(directory / "package.json")
    if not isinstance(parsed, dict):
        return
    apply_fields(
        target,
        {
            "description": as_string(parsed.get("description")),
            "feedbackEmail": author_email(parsed.get("author")),
        },
        "package.json",
    )
    package_name = as_string(parsed.get("name"))
    if package_name:
        apply_fields_if_absent(
            target, {"description": f"Beta of {package_name}."}, "package.json"
        )


def apply_readme(directory: Path, target: dict[str, Any]) -> None:
    if target.get("description"):
        return
    text = read_text_if_present(directory / "README.md")
    if not text:
        return
    paragraph = first_readme_paragraph(text)
    if paragraph:
        apply_fields(target, {"description": paragraph}, "README.md")


def apply_info_plists(directory: Path, target: dict[str, Any]) -> None:
    for file_path in list_files(directory):
        if not str(file_path).endswith("Info.plist"):
            continue
        if is_test_path(file_path, directory):
            continue
        parsed = parse_plist_file(file_path)
        if parsed is None:
            continue
        source = os.path.relpath(file_path, directory)
        bundle_id = as_string(parsed.get("CFBundleIdentifier"))
        if bundle_id and "$" not in bundle_id:
            remember_bundle_id(target, bundle_id, source)
        locale = as_string(parsed.get("CFBundleDevelopmentRegion"))
        if locale and "$" not in locale:
            apply_fields(target, {"locale": locale}, source)
        display_name = as_string(parsed.get("CFBundleDisplayName")) or as_string(
            parsed.get("CFBundleName")
        )
        if display_name and "$" not in display_name:
            apply_fields(target, {"description": f"Beta of {display_name}."}, source)


def apply_xcconfig(directory: Path, target: dict[str, Any]) -> None:
    for file_path in list_files(directory):
        if not str(file_path).endswith(".xcconfig"):
            continue
        text = read_text_if_present(file_path)
        if not text:
            continue
        source = os.path.relpath(file_path, directory)
        for match in XCCONFIG_BUNDLE_ID.finditer(text):
            line_start = text.rfind("\n", 0, match.start()) + 1
            if text[line_start : match.start()].lstrip().startswith("//"):
                continue
            bundle_id = match.group(1).strip().strip('"')
            if bundle_id and "$" not in bundle_id:
                remember_bundle_id(target, bundle_id, source)


def apply_pbxproj(directory: Path, target: dict[str, Any]) -> None:
    for file_path in list_files(directory):
        if not str(file_path).endswith(".pbxproj"):
            continue
        text = read_text_if_present(file_path)
        if not text:
            continue
        source = os.path.relpath(file_path, directory)
        for match in PBX_BUNDLE_ID.finditer(text):
            bundle_id = match.group(1).strip().strip('"')
            if bundle_id and "$" not in bundle_id:
                remember_bundle_id(target, bundle_id, source)


def apply_support_emails(directory: Path, target: dict[str, Any]) -> None:
    if target.get("feedbackEmail"):
        return
    found: dict[str, str] = {}
    for file_path in list_files(directory):
        if file_path.suffix not in EMAIL_FILE_SUFFIXES:
            continue
        if file_path.name in SKIP_EMAIL_FILENAMES:
            continue
        text = read_text_if_present(file_path)
        if not text:
            continue
        source = os.path.relpath(file_path, directory)
        for match in MAILTO_RE.finditer(text):
            email = scanned_email(match.group(1))
            if email:
                found.setdefault(email, source)
        for match in SUPPORT_EMAIL_RE.finditer(text):
            email = scanned_email(match.group(1))
            if email:
                found.setdefault(email, source)
    if not found:
        return
    if len(found) == 1:
        email, source = next(iter(found.items()))
        apply_fields(target, {"feedbackEmail": email}, source)
        return
    preferred = {
        email: source
        for email, source in found.items()
        if email.split("@", 1)[0].lower() in {"support", "feedback", "ios-support"}
    }
    if len(preferred) == 1:
        email, source = next(iter(preferred.items()))
        apply_fields(target, {"feedbackEmail": email}, source)


def list_files(directory: Path) -> list[Path]:
    files: list[Path] = []
    try:
        entries = list(directory.iterdir())
    except OSError:
        return []
    for entry in entries:
        is_apple_actions = entry.name == ".apple-actions"
        if not is_apple_actions and (
            entry.name in SKIP_DIR_NAMES
            or entry.name.startswith(".")
            or is_skip_dir_name(entry.name)
        ):
            continue
        if entry.is_dir():
            files.extend(list_files(entry))
            continue
        if entry.is_file():
            files.append(entry)
    return files


def is_skip_dir_name(name: str) -> bool:
    return name.endswith(SKIP_DIR_SUFFIXES)


def is_test_path(file_path: Path, root: Path) -> bool:
    try:
        parts = file_path.relative_to(root).parts
    except ValueError:
        parts = file_path.parts
    return any(part.endswith(SKIP_DIR_SUFFIXES) for part in parts[:-1])


def parse_plist_file(file_path: Path) -> dict[str, Any] | None:
    try:
        with file_path.open("rb") as handle:
            parsed = plistlib.load(handle)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def read_json_if_present(file_path: Path) -> Any:
    text = read_text_if_present(file_path)
    if text is None:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        raise RuntimeError(f"Invalid JSON in {file_path}.") from err


def read_text_if_present(file_path: Path) -> str | None:
    try:
        if not file_path.is_file():
            return None
        return file_path.read_text(encoding="utf-8")
    except OSError:
        return None


def first_readme_paragraph(markdown: str) -> str | None:
    stripped = HTML_COMMENT_RE.sub("", markdown)
    chunks: list[str] = []
    in_paragraph = False
    for line in stripped.splitlines():
        trimmed = line.strip()
        if not trimmed or should_skip_readme_line(trimmed):
            if in_paragraph:
                break
            continue
        in_paragraph = True
        chunks.append(trimmed)
    paragraph = " ".join(chunks).strip()
    if len(paragraph) < 20 or is_boilerplate_description(paragraph):
        return None
    return paragraph


def should_skip_readme_line(line: str) -> bool:
    return (
        line.startswith("#")
        or line.startswith("[![")
        or line.startswith("![")
        or line.startswith("```")
        or line.startswith("> ")
        or line.startswith("Actions →")
        or "Run workflow" in line
        or "managed:ios-release-buttons" in line
    )


def is_boilerplate_description(text: str) -> bool:
    lowered = text.lower()
    return "infinite red" in lowered or "ignited app" in lowered


def author_email(author: Any) -> str | None:
    if isinstance(author, str):
        match = re.search(r"<([^>]+)>", author)
        return as_trimmed(match.group(1)) if match else None
    if isinstance(author, dict):
        return as_trimmed(as_string(author.get("email")))
    return None


def scanned_email(value: str | None) -> str | None:
    email = as_trimmed(value)
    if not email or "@" not in email:
        return None
    domain = email.split("@", 1)[1].lower()
    if domain in PLACEHOLDER_EMAIL_DOMAINS:
        return None
    if domain.rsplit(".", 1)[-1] in {"png", "jpg", "jpeg", "gif", "webp"}:
        return None
    return email


def as_string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def as_trimmed(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


if __name__ == "__main__":
    sys.exit(main())
