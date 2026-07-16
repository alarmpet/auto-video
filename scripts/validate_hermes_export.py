from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path


BLOCK_RE = re.compile(r"\[([^\]]+)\]\s*([\s\S]*?)(?=\n\s*\[[^\]]+\]|\s*$)")


@dataclass
class SceneBlock:
    order: int
    narration: str
    prompt: str
    camera: str
    lighting: str
    mood: str
    motion: str


def parse_manual_storyboard(path: Path) -> tuple[list[SceneBlock], list[str]]:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").strip()
    warnings: list[str] = []
    scenes: list[SceneBlock] = []
    ranges: list[tuple[int, int]] = []

    for match in BLOCK_RE.finditer(text):
        ranges.append((match.start(), match.end()))
        narration = clean(match.group(1))
        raw_prompt = clean(match.group(2))
        if not narration or not raw_prompt:
            warnings.append(f"block {len(scenes) + 1}: empty narration or prompt")
            continue
        parts = [clean(part) for part in raw_prompt.split("/")]
        if len(parts) < 5:
            warnings.append(
                f"block {len(scenes) + 1}: expected prompt / camera / lighting / mood / motion"
            )
            parts = parts + [""] * (5 - len(parts))
        prompt_parts = parts[:-4] if len(parts) >= 5 else [parts[0]]
        camera, lighting, mood, motion = (parts[-4:] if len(parts) >= 5 else parts[1:5])
        prompt = "/".join(prompt_parts).strip()
        scenes.append(
            SceneBlock(
                order=len(scenes) + 1,
                narration=narration,
                prompt=prompt,
                camera=camera,
                lighting=lighting,
                mood=mood,
                motion=motion,
            )
        )

    assert_no_residue(text, ranges)
    if not scenes:
        raise ValueError("hermes-manual-storyboard.md has no valid [narration] blocks")
    return scenes, warnings


def assert_no_residue(text: str, ranges: list[tuple[int, int]]) -> None:
    cursor = 0
    for start, end in ranges:
        if text[cursor:start].strip():
            raise ValueError("manual storyboard contains text outside [narration] blocks")
        cursor = end
    if text[cursor:].strip():
        raise ValueError("manual storyboard contains text outside [narration] blocks")


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def meaningful_chars(scenes: list[SceneBlock]) -> int:
    return sum(len(re.sub(r"\s+", "", scene.narration)) for scene in scenes)


def required_scene_count(target_seconds, *, max_scene_seconds: int = 75) -> int:
    try:
        seconds = float(target_seconds)
    except (TypeError, ValueError):
        return 0
    if seconds < 600:
        return 0
    return max(8, int((seconds + max_scene_seconds - 1) // max_scene_seconds))


def validate_export(export_dir: Path) -> dict:
    storyboard_path = export_dir / "hermes-manual-storyboard.md"
    if not storyboard_path.exists():
        raise FileNotFoundError(f"missing {storyboard_path}")

    scenes, warnings = parse_manual_storyboard(storyboard_path)
    chapters = load_json(export_dir / "chapters.json", [])
    production = load_json(export_dir / "production.json", {})

    chapter_scene_total = sum(len(chapter.get("scene_orders", [])) for chapter in chapters)
    if chapters and chapter_scene_total != len(scenes):
        warnings.append(
            f"chapters.json scene_orders total {chapter_scene_total} != storyboard scenes {len(scenes)}"
        )

    missing_fields = []
    for scene in scenes:
        for field in ("prompt", "camera", "lighting", "mood", "motion"):
            if not getattr(scene, field):
                missing_fields.append({"order": scene.order, "field": field})

    target_seconds = production.get("render", {}).get("target_seconds")
    if target_seconds is None:
        target_seconds = production.get("targetSeconds")
    target_minutes = production.get("project", {}).get("target_minutes")
    is_longform = (
        (isinstance(target_seconds, (int, float)) and target_seconds >= 600)
        or (isinstance(target_minutes, (int, float)) and target_minutes >= 10)
    )
    chars = meaningful_chars(scenes)
    target_label = target_seconds if target_seconds else (target_minutes * 60 if target_minutes else None)
    if is_longform and chars < 4500:
        warnings.append(
            f"longform narration length {chars} chars is below minimum 4500 for target_seconds {target_label}"
        )

    hard_failures = []
    min_scene_count = required_scene_count(target_label)
    if is_longform and min_scene_count and len(scenes) < min_scene_count:
        hard_failures.append(
            f"storyboard_blocks_too_low:{len(scenes)}<{min_scene_count} "
            f"for target_seconds {target_label}"
        )

    if is_longform:
        prefixes = Counter(clean(scene.narration)[:42] for scene in scenes if scene.narration)
        bad_prefixes = [(prefix, count) for prefix, count in prefixes.items() if count > 3]
        if bad_prefixes:
            hard_failures.append(f"repeated_scene_narration_prefixes:{bad_prefixes[:5]}")

    hard_fail = any("longform narration length" in warning for warning in warnings) or bool(hard_failures)
    status = "fail" if missing_fields or hard_fail else "warn" if warnings else "pass"
    return {
        "status": status,
        "export_dir": str(export_dir),
        "storyboard": str(storyboard_path),
        "scene_count": len(scenes),
        "chapter_count": len(chapters),
        "target_seconds": target_seconds,
        "target_minutes": target_minutes,
        "required_scene_count": min_scene_count,
        "meaningful_chars": chars,
        "missing_fields": missing_fields,
        "hard_failures": hard_failures,
        "warnings": warnings,
        "scenes": [scene.__dict__ for scene in scenes],
    }


def write_markdown(report: dict, path: Path) -> None:
    lines = [
        "# Hermes Export Validation Report",
        "",
        f"- Status: `{report['status']}`",
        f"- Scene count: `{report['scene_count']}`",
        f"- Chapter count: `{report['chapter_count']}`",
        f"- Target seconds: `{report.get('target_seconds')}`",
        "",
        "## Warnings",
        "",
    ]
    if report["warnings"]:
        lines.extend(f"- {warning}" for warning in report["warnings"])
    else:
        lines.append("- None")
    lines.extend(["", "## Hard Failures", ""])
    if report.get("hard_failures"):
        lines.extend(f"- {failure}" for failure in report["hard_failures"])
    else:
        lines.append("- None")
    lines.extend(["", "## Missing Fields", ""])
    if report["missing_fields"]:
        lines.extend(
            f"- scene {item['order']}: {item['field']}" for item in report["missing_fields"]
        )
    else:
        lines.append("- None")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-dir", required=True)
    args = parser.parse_args()

    export_dir = Path(args.export_dir).resolve()
    report = validate_export(export_dir)
    validation_dir = export_dir / "validation"
    validation_dir.mkdir(parents=True, exist_ok=True)
    (validation_dir / "asset-validation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_markdown(report, validation_dir / "asset-validation-report.md")
    print(f"Hermes export validation: {report['status']} ({report['scene_count']} scenes)")
    return 0 if report["status"] in {"pass", "warn"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
