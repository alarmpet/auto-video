export function isYadamTimeline(visualTimeline) {
  return visualTimeline && visualTimeline.profileId === "yadam";
}

export function assertYadamAssemblerOptions(options) {
  if (options.finalName !== "final.mp4") {
    throw Object.assign(new Error("yadam final name must be final.mp4"), { code: "invalid_yadam_assembler_option" });
  }
  if (!options.preserveAudioTempo) {
    throw Object.assign(new Error("yadam must preserve audio tempo"), { code: "invalid_yadam_assembler_option" });
  }
  if (options.motionFps !== 24) {
    throw Object.assign(new Error("yadam motion FPS must be 24"), { code: "invalid_yadam_assembler_option" });
  }
  if (!options.preserveColor) {
    throw Object.assign(new Error("yadam must preserve color"), { code: "invalid_yadam_assembler_option" });
  }
  if (options.allowFastAudio || options.maxAudioTempo !== undefined) {
    throw Object.assign(new Error("yadam forbids fast audio or custom max audio tempo"), { code: "forbidden_yadam_audio_option" });
  }
}

export function assertExactTimelineEnd(lastVisualEnd, measuredAudioSeconds) {
  const diff = Math.abs(lastVisualEnd - measuredAudioSeconds);
  if (diff > 0.05) {
    throw Object.assign(new Error(`yadam timeline end ${lastVisualEnd} differs from audio ${measuredAudioSeconds} by ${diff} (> 0.05)`), {
      code: "yadam_timeline_end_mismatch"
    });
  }
}

export function assertTimelineContinuity(slots) {
  if (!slots || slots.length === 0) {
    throw new Error("No visual slots in timeline");
  }
  if (slots[0].startSeconds > 0.01) {
    throw new Error(`First slot start ${slots[0].startSeconds} exceeds 0.01`);
  }
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.durationSeconds <= 0) {
      throw new Error(`Slot duration must be positive: ${slot.visualSlotId}`);
    }
    const mathDur = slot.endSeconds - slot.startSeconds;
    if (Math.abs(slot.durationSeconds - mathDur) > 0.01) {
      throw new Error(`Duration mismatch in slot ${slot.visualSlotId}`);
    }
    if (i > 0) {
      const prev = slots[i - 1];
      if (Math.abs(slot.startSeconds - prev.endSeconds) > 0.01) {
        throw new Error(`Timeline gap or overlap exceeds 0.01s between ${prev.visualSlotId} and ${slot.visualSlotId}`);
      }
    }
  }
}

export function buildFrameWindows(slots, fps) {
  return slots.map(slot => {
    const startFrame = Math.round(slot.startSeconds * fps);
    const endFrame = Math.round(slot.endSeconds * fps);
    const frameCount = endFrame - startFrame;
    if (frameCount < 1) {
      throw new Error(`Frame count < 1 for visual slot ${slot.visualSlotId}`);
    }
    const actualStart = startFrame / fps;
    const actualEnd = endFrame / fps;
    const actualDuration = frameCount / fps;
    
    if (Math.abs(slot.startSeconds - actualStart) > 1 / fps + 0.001 ||
        Math.abs(slot.endSeconds - actualEnd) > 1 / fps + 0.001) {
      throw new Error(`Frame boundary difference exceeds one frame for slot ${slot.visualSlotId}`);
    }

    return {
      visualSlotId: slot.visualSlotId,
      startFrame,
      endFrame,
      frameCount,
      actualStart,
      actualEnd,
      actualDuration
    };
  });
}

export function assertVisualKeyframePairs(timelineScenes, keyframes) {
  if (timelineScenes.length !== keyframes.length) {
    throw Object.assign(new Error("timeline and keyframes length mismatch"), { code: "yadam_keyframe_mismatch" });
  }
  for (let i = 0; i < timelineScenes.length; i++) {
    const tScene = timelineScenes[i];
    const kf = keyframes[i];
    if (tScene.visualSlotId !== kf.visualSlotId) {
      throw Object.assign(new Error(`visualSlotId mismatch at index ${i}: ${tScene.visualSlotId} !== ${kf.visualSlotId}`), {
        code: "yadam_keyframe_mismatch"
      });
    }
  }
}
