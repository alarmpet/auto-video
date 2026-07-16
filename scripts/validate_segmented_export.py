from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


BLOCK_RE = re.compile(r"\[([^\]]+)\]\s*([\s\S]*?)(?=\n\s*\[[^\]]+\]|\s*$)")
SRT_TIME_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})"
)
VALID_MOTIONS = {
    "zoomin",
    "zoomout",
    "panL",
    "panR",
    "panU",
    "panD",
    "diagUL",
    "diagUR",
    "diagDL",
    "diagDR",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def maybe_float(value: object) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_visual_timeline(segment_dir: Path) -> dict | None:
    path = segment_dir / "visual-timeline.json"
    if not path.exists():
        return None
    return load_json(path)


def parse_storyboard_blocks(path: Path) -> tuple[int, list[str]]:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").strip()
    warnings: list[str] = []
    ranges: list[tuple[int, int]] = []
    count = 0

    for match in BLOCK_RE.finditer(text):
        ranges.append((match.start(), match.end()))
        narration = clean(match.group(1))
        raw_prompt = clean(match.group(2))
        if not narration or not raw_prompt:
            warnings.append(f"block {count + 1}: empty narration or prompt")
            continue
        parts = [clean(part) for part in raw_prompt.split("/")]
        if len(parts) < 5:
            warnings.append(f"block {count + 1}: expected prompt / camera / lighting / mood / motion")
        count += 1

    cursor = 0
    for start, end in ranges:
        if text[cursor:start].strip():
            warnings.append("storyboard contains text outside [narration] blocks")
            break
        cursor = end
    if text[cursor:].strip():
        warnings.append("storyboard contains trailing text outside [narration] blocks")

    return count, warnings


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def ffprobe_duration(path: Path) -> float:
    raw = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        text=True,
        encoding="utf-8",
    ).strip()
    return float(raw)


def safe_ffprobe_duration(path: Path) -> float | None:
    try:
        return ffprobe_duration(path)
    except (subprocess.SubprocessError, OSError, ValueError):
        return None


def validate_visual_motion_groups(segment_id: str, assembly: dict, assembly_dir: Path) -> list[str]:
    failures: list[str] = []
    groups = assembly.get("visualGroups") or []
    if not groups:
        return [f"{segment_id}: visualGroups missing or empty"]

    motions = [group.get("motion") for group in groups]
    if any(not motion for motion in motions):
        failures.append(f"{segment_id}: visualGroups contain missing motion metadata")
    for motion in motions:
        if motion and motion not in VALID_MOTIONS:
            failures.append(f"{segment_id}: unknown visual motion {motion}")
    for index in range(1, len(motions)):
        if motions[index] and motions[index] == motions[index - 1]:
            failures.append(f"{segment_id}: repeated visual motion at groups {index} and {index + 1}")
    if len(groups) >= 10 and len(set(motions)) < 5:
        failures.append(f"{segment_id}: visual motion variety too low")

    for index, group in enumerate(groups, start=1):
        duration = maybe_float(group.get("duration"))
        effective_zoom = maybe_float(group.get("effectiveZoom"))
        fps = maybe_float(group.get("fps"))
        if group.get("motion") and effective_zoom is None:
            failures.append(f"{segment_id}: visual group {index} missing effectiveZoom")
        elif effective_zoom is not None and (effective_zoom <= 0 or effective_zoom > 0.12):
            failures.append(f"{segment_id}: visual group {index} invalid effectiveZoom {effective_zoom}")
        if group.get("motion") and fps is None:
            failures.append(f"{segment_id}: visual group {index} missing fps")
        if group.get("motion") and not group.get("clip"):
            failures.append(f"{segment_id}: visual group {index} missing clip")
        elif group.get("clip"):
            clip_path = assembly_dir / "motion-clips" / str(group.get("clip"))
            if not clip_path.exists():
                failures.append(f"{segment_id}: visual group {index} clip file missing")
            elif duration is not None:
                clip_duration = safe_ffprobe_duration(clip_path)
                if clip_duration is None:
                    failures.append(f"{segment_id}: visual group {index} clip duration unreadable")
                elif abs(clip_duration - duration) > max(0.75, duration * 0.03):
                    failures.append(
                        f"{segment_id}: visual group {index} clip duration {clip_duration:.3f}s != {duration:.3f}s"
                    )
    return failures


def ffprobe_profile(path: Path) -> dict:
    raw = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)],
        text=True,
        encoding="utf-8",
    )
    data = json.loads(raw)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), {})
    return {
        "videoCodec": video.get("codec_name"),
        "codecTagString": video.get("codec_tag_string"),
        "width": video.get("width"),
        "height": video.get("height"),
        "pixFmt": video.get("pix_fmt"),
        "rFrameRate": video.get("r_frame_rate"),
        "timeBase": video.get("time_base"),
        "bitsPerRawSample": video.get("bits_per_raw_sample"),
        "audioCodec": audio.get("codec_name"),
        "sampleFmt": audio.get("sample_fmt"),
        "sampleRate": audio.get("sample_rate"),
        "channels": audio.get("channels"),
        "channelLayout": audio.get("channel_layout"),
    }


def validate_matching_profiles(final_paths: list[Path]) -> list[str]:
    if len(final_paths) < 2:
        return []
    profiles = [(path, ffprobe_profile(path)) for path in final_paths]
    baseline_path, baseline = profiles[0]
    failures: list[str] = []
    for path, profile in profiles[1:]:
        if profile != baseline:
            failures.append(
                f"stream profile mismatch: {path} differs from {baseline_path}; "
                f"baseline={baseline}; actual={profile}"
            )
    return failures


def parse_srt_end_seconds(path: Path) -> float | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    matches = list(SRT_TIME_RE.finditer(text))
    if not matches:
        return None
    match = matches[-1]
    return time_parts_to_seconds(match.groups()[4:])


def time_parts_to_seconds(parts: tuple[str, ...]) -> float:
    h, m, s, ms = [int(part) for part in parts]
    return h * 3600 + m * 60 + s + ms / 1000


def validate(export_dir: Path) -> dict:
    manifest_path = export_dir / "segment-manifest.json"
    failures: list[str] = []
    warnings: list[str] = []
    if not manifest_path.exists():
        return {"status": "fail", "failures": [f"missing {manifest_path}"], "warnings": []}

    manifest = load_json(manifest_path)
    segment_reports = []
    ready_final_paths: list[Path] = []
    total_ready_duration = 0.0

    for segment in manifest.get("segments", []):
        segment_id = segment.get("id", "<missing-id>")
        segment_dir_value = segment.get("dir")
        if not segment_dir_value:
            failures.append(f"{segment_id}: missing dir in segment manifest")
            continue
        segment_dir = Path(segment_dir_value)
        storyboard = segment_dir / "hermes-manual-storyboard.md"
        production = segment_dir / "production.json"
        script = segment_dir / "script.txt"
        script_quality_report = segment_dir / "script-quality-report.json"
        script_quality_suite_report = segment_dir / "script-quality-suite-report.json"

        if not storyboard.exists():
            failures.append(f"{segment_id}: missing storyboard")
            continue
        if not production.exists():
            failures.append(f"{segment_id}: missing production.json")
        if not script.exists():
            failures.append(f"{segment_id}: missing script.txt")
        if script_quality_report.exists():
            script_quality = load_json(script_quality_report)
            if script_quality.get("ok") is False:
                failures.append(f"{segment_id}: script-quality-report failed")
        else:
            warnings.append(f"{segment_id}: script-quality-report.json not generated yet")
        if script_quality_suite_report.exists():
            script_quality_suite = load_json(script_quality_suite_report)
            if script_quality_suite.get("ok") is False:
                failures.append(f"{segment_id}: script-quality-suite-report failed")
        else:
            warnings.append(f"{segment_id}: script-quality-suite-report.json not generated yet")

        blocks, storyboard_warnings = parse_storyboard_blocks(storyboard)
        warnings.extend(f"{segment_id}: {warning}" for warning in storyboard_warnings)
        expected = int(segment.get("sceneCount", 0))
        if blocks != expected:
            failures.append(f"{segment_id}: storyboard blocks {blocks} != manifest sceneCount {expected}")

        storyboard_text = storyboard.read_text(encoding="utf-8")
        duration_tag_count = len(re.findall(r"\bduration\s*:", storyboard_text, flags=re.IGNORECASE))
        if duration_tag_count != expected:
            failures.append(f"{segment_id}: storyboard duration tags {duration_tag_count} != sceneCount {expected}")

        timeline = load_visual_timeline(segment_dir)
        if timeline is None:
            failures.append(f"{segment_id}: missing visual-timeline.json")
        else:
            timeline_scenes = timeline.get("scenes", [])
            if len(timeline_scenes) != expected:
                failures.append(
                    f"{segment_id}: visual timeline scenes {len(timeline_scenes)} != manifest sceneCount {expected}"
                )
            timeline_end = float(timeline_scenes[-1].get("endSeconds", 0)) if timeline_scenes else 0.0
            target_duration = float(segment.get("durationSeconds", 0) or 0)
            if abs(timeline_end - target_duration) > 0.01:
                failures.append(
                    f"{segment_id}: visual timeline end {timeline_end:.3f}s != target {target_duration:.3f}s"
                )
            if segment_id == "segment-01":
                opening_scenes = [scene for scene in timeline_scenes if scene.get("timingBand") == "opening"]
                body_scenes = [scene for scene in timeline_scenes if scene.get("timingBand") == "body"]
                if len(opening_scenes) != 10:
                    failures.append(f"segment-01: expected 10 opening visual scenes, got {len(opening_scenes)}")
                for scene in opening_scenes:
                    duration = float(scene.get("durationSeconds", 0) or 0)
                    if duration > 6.5:
                        failures.append(
                            f"segment-01: opening scene {scene.get('order')} duration {duration:.3f}s exceeds 6.5s"
                        )
                for index, scene in enumerate(body_scenes):
                    duration = float(scene.get("durationSeconds", 0) or 0)
                    is_last_body_scene = index == len(body_scenes) - 1
                    if not is_last_body_scene and duration < 20:
                        failures.append(
                            f"segment-01: body scene {scene.get('order')} duration {duration:.3f}s is below 20s"
                        )
                    if duration > 40.5:
                        failures.append(
                            f"segment-01: body scene {scene.get('order')} duration {duration:.3f}s exceeds 40.5s"
                        )

        grounding_report = segment_dir / "visual-grounding-timeline-report.json"
        if not grounding_report.exists():
            warnings.append(f"{segment_id}: visual-grounding-timeline-report.json not generated yet")
        else:
            try:
                grounding = json.loads(grounding_report.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                failures.append(f"{segment_id}: visual-grounding-timeline-report.json is not valid JSON")
            else:
                if not grounding.get("ok"):
                    failures.append(f"{segment_id}: visual grounding timeline failed")

        sync_report = segment_dir / "manual-assembly" / "subtitle-sync-report.json"
        assembly_report = segment_dir / "manual-assembly" / "assembly-report.json"
        final_mp4 = segment_dir / "manual-assembly" / "final.mp4"
        srt_path = segment_dir / "manual-assembly" / "subtitles.srt"
        sync_status = "missing"
        final_duration = None
        subtitle_end = parse_srt_end_seconds(srt_path)

        if sync_report.exists():
            sync = load_json(sync_report)
            if sync.get("audioSubtitleEndDeltaSeconds", 999) > 0.5:
                failures.append(f"{segment_id}: subtitle/audio end delta > 0.5s")
            if sync.get("maxCueSeconds", 999) > 8:
                failures.append(f"{segment_id}: maxCueSeconds > 8")
            sync_status = "present"
        else:
            warnings.append(f"{segment_id}: subtitle-sync-report.json not generated yet")

        if not final_mp4.exists():
            warnings.append(f"{segment_id}: final.mp4 not generated yet")
        else:
            if assembly_report.exists():
                assembly = load_json(assembly_report)
                audio_tempo_factor = maybe_float(assembly.get("audioTempoFactor"))
                if audio_tempo_factor is None:
                    warnings.append(f"{segment_id}: assembly-report audioTempoFactor missing or invalid")
                elif audio_tempo_factor > 1.18:
                    failures.append(
                        f"{segment_id}: audioTempoFactor {audio_tempo_factor:.3f} exceeds 1.18"
                    )
                elif audio_tempo_factor < 0.92:
                    failures.append(
                        f"{segment_id}: audioTempoFactor {audio_tempo_factor:.3f} is below 0.92"
                    )
                failures.extend(validate_visual_motion_groups(segment_id, assembly, assembly_report.parent))
            else:
                warnings.append(f"{segment_id}: assembly-report.json not generated yet")
            ready_final_paths.append(final_mp4)
            final_duration = ffprobe_duration(final_mp4)
            total_ready_duration += final_duration
            target_duration = float(segment.get("durationSeconds", 0) or 0)
            if target_duration and abs(final_duration - target_duration) > max(15.0, target_duration * 0.08):
                warnings.append(
                    f"{segment_id}: final duration {final_duration:.3f}s differs from target {target_duration:.3f}s"
                )
            if subtitle_end is None:
                warnings.append(f"{segment_id}: subtitles.srt missing or unparseable")
            elif abs(final_duration - subtitle_end) > 0.75:
                failures.append(
                    f"{segment_id}: final duration {final_duration:.3f}s != subtitle end {subtitle_end:.3f}s"
                )

        segment_reports.append(
            {
                "id": segment_id,
                "storyboardBlocks": blocks,
                "expectedSceneCount": expected,
                "syncStatus": sync_status,
                "finalExists": final_mp4.exists(),
                "finalDurationSeconds": final_duration,
                "subtitleEndSeconds": subtitle_end,
            }
        )

    failures.extend(validate_matching_profiles(ready_final_paths))

    capcut_manifest = export_dir / "capcut-draft" / "capcut-draft-manifest.json"
    if capcut_manifest.exists():
        capcut = load_json(capcut_manifest)
        if capcut.get("format") != "auto-video-capcut-qa-manifest-only-v1":
            failures.append("capcut draft manifest format is invalid")
        capcut_segments = capcut.get("segments", [])
        manifest_segments = manifest.get("segments", [])
        if len(capcut_segments) != len(manifest_segments):
            failures.append(
                f"capcut draft segment count {len(capcut_segments)} != manifest segment count {len(manifest_segments)}"
            )

    target_seconds = float(manifest.get("targetSeconds", 0) or 0)
    if target_seconds and len(ready_final_paths) == len(manifest.get("segments", [])):
        if abs(total_ready_duration - target_seconds) > max(20.0, target_seconds * 0.05):
            warnings.append(
                f"total rendered duration {total_ready_duration:.3f}s differs from target {target_seconds:.3f}s"
            )

    status = "fail" if failures else "warn" if warnings else "pass"
    return {
        "status": status,
        "exportDir": str(export_dir),
        "failures": failures,
        "warnings": warnings,
        "readyFinalCount": len(ready_final_paths),
        "totalReadyDurationSeconds": total_ready_duration,
        "segments": segment_reports,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-dir", required=True)
    args = parser.parse_args()
    export_dir = Path(args.export_dir).resolve()
    report = validate(export_dir)
    validation_dir = export_dir / "validation"
    validation_dir.mkdir(parents=True, exist_ok=True)
    (validation_dir / "segmented-validation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Segmented export validation: {report['status']}")
    return 0 if report["status"] in {"pass", "warn"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
