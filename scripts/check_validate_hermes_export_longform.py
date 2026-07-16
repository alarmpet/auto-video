from pathlib import Path
from tempfile import TemporaryDirectory

from validate_hermes_export import validate_export


def write_export(root: Path, production_json: str, narration: str) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "hermes-manual-storyboard.md").write_text(
        f"[{narration}]\n"
        "A quiet ancient garden, black and white painterly biblical oil illustration / wide shot / soft light / calm / slow push-in\n",
        encoding="utf-8",
    )
    (root / "production.json").write_text(production_json, encoding="utf-8")


with TemporaryDirectory() as tmp:
    export_dir = Path(tmp)
    write_export(export_dir, '{"render":{"target_seconds":660},"project":{"target_minutes":10}}', "짧은 원고입니다.")
    report = validate_export(export_dir)
    assert report["status"] == "fail"
    assert any("longform narration length" in warning for warning in report["warnings"])

with TemporaryDirectory() as tmp:
    export_dir = Path(tmp)
    write_export(export_dir, '{"render":{},"project":{"target_minutes":10}}', "짧은 원고입니다.")
    report = validate_export(export_dir)
    assert report["status"] == "fail"
    assert any("longform narration length" in warning for warning in report["warnings"])

print("check_validate_hermes_export_longform: pass")
