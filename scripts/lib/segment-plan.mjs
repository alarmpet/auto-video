export function deriveSceneCountForWindow({
  startSeconds,
  durationSeconds,
  introSeconds = 60,
  introSceneSeconds = 6,
  bodySceneSeconds = 30,
}) {
  const start = Math.max(0, Number(startSeconds) || 0);
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const end = start + duration;
  const introEnd = Math.max(0, Number(introSeconds) || 0);
  const introOverlap = Math.max(0, Math.min(end, introEnd) - Math.min(start, introEnd));
  const bodyDuration = Math.max(0, duration - introOverlap);
  const introScenes = introOverlap > 0 ? Math.ceil(introOverlap / introSceneSeconds) : 0;
  const bodyScenes = bodyDuration > 0 ? Math.ceil(bodyDuration / bodySceneSeconds) : 0;
  return Math.max(1, introScenes + bodyScenes);
}

export function buildSegmentPlan({
  targetSeconds,
  segmentMinutes = 15,
  introSeconds = 60,
  introSceneSeconds = 6,
  bodySceneSeconds = 30,
}) {
  const total = Math.max(1, Math.round(Number(targetSeconds) || 3600));
  const segmentSeconds = Math.max(60, Math.round((Number(segmentMinutes) || 15) * 60));
  const segments = [];
  let cursor = 0;

  while (cursor < total) {
    const duration = Math.min(segmentSeconds, total - cursor);
    const estimatedSceneCount = deriveSceneCountForWindow({
      startSeconds: cursor,
      durationSeconds: duration,
      introSeconds,
      introSceneSeconds,
      bodySceneSeconds,
    });
    segments.push({
      index: segments.length + 1,
      id: `segment-${String(segments.length + 1).padStart(2, "0")}`,
      startSeconds: cursor,
      durationSeconds: duration,
      endSeconds: cursor + duration,
      estimatedSceneCount,
      sceneCount: estimatedSceneCount,
    });
    cursor += duration;
  }

  return {
    targetSeconds: total,
    segmentMinutes,
    segmentSeconds,
    introSeconds,
    introSceneSeconds,
    bodySceneSeconds,
    totalSceneCount: segments.reduce((sum, segment) => sum + segment.sceneCount, 0),
    segments,
  };
}

export function buildVisualTimelineForWindow({
  startSeconds,
  durationSeconds,
  introSeconds = 60,
  introSceneSeconds = 6,
  bodySceneSeconds = 30,
}) {
  const segmentStart = Math.max(0, Number(startSeconds) || 0);
  const segmentDuration = Math.max(0, Number(durationSeconds) || 0);
  const segmentEnd = segmentStart + segmentDuration;
  const introEnd = Math.max(0, Number(introSeconds) || 0);
  const scenes = [];
  let cursor = segmentStart;

  while (cursor < segmentEnd - 0.001) {
    const sceneSeconds = cursor < introEnd ? introSceneSeconds : bodySceneSeconds;
    const end = Math.min(segmentEnd, cursor + sceneSeconds);
    scenes.push({
      order: scenes.length + 1,
      startSeconds: Number((cursor - segmentStart).toFixed(3)),
      endSeconds: Number((end - segmentStart).toFixed(3)),
      durationSeconds: Number((end - cursor).toFixed(3)),
    });
    cursor = end;
  }

  return scenes;
}
