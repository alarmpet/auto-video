from pathlib import Path

doc = Path("auto-video.md").read_text(encoding="utf-8")

required = [
    "완성된 MP4를 느리게 늘려서 10분을 맞추지 않는다",
    "10분 이상은 대본 분량과 장면 수로 먼저 맞춘다",
    "상단 영어 라벨이나 워터마크가 보이면 후처리로 흐리지 말고 이미지를 재생성한다",
    "10분 영상의 1차 목표 원고는 4,500~6,000자",
]

missing = [line for line in required if line not in doc]
if missing:
    raise SystemExit("missing policy lines: " + "; ".join(missing))

print("check_auto_video_policy: pass")
