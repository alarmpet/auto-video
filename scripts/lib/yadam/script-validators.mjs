// scripts/lib/yadam/script-validators.mjs

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

function getNarrationOnly(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('"') && !l.startsWith('“'));
}

export function checkHanja(text) {
  const matches = text.match(/[\u4e00-\u9fff]/g) || [];
  return { passed: matches.length === 0, violations: matches.map(m => `Hanja character: ${m}`) };
}

export function checkMeta(text) {
  const patterns = [
    /^\[.*?\]\s*\w*$/u,
    /^【.*?】\s*\w*$/u,
    /^챕터\s*\d+.*$/u,
    /^제\s*\d+\s*장.*$/u,
    /^\d+\s*장\s+.*$/u,
    /^---+$u/,
    /^\*\*\*+$/u,
    /^===+$/u
  ];
  const violations = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    patterns.forEach(p => {
      if (p.test(trimmed)) {
        violations.push(`Line ${idx + 1} has meta info: ${trimmed}`);
      }
    });
  });
  return { passed: violations.length === 0, violations };
}

export function checkQuotePairs(text) {
  const smartOpen = (text.match(/“/g) || []).length;
  const smartClose = (text.match(/”/g) || []).length;
  const standardQuotes = (text.match(/"/g) || []).length;
  
  const violations = [];
  if (smartOpen !== smartClose) {
    violations.push(`Smart quotes mismatch: open ${smartOpen} vs close ${smartClose}`);
  }
  if (standardQuotes % 2 !== 0) {
    violations.push(`Standard quotes are odd: ${standardQuotes}`);
  }
  return { passed: violations.length === 0, violations };
}

export function checkAdjacentSameDialogue(text) {
  const dialogues = Array.from(text.matchAll(/[“"]([^”"]+)[”"]/g)).map(m => m[1].trim());
  const violations = [];
  for (let i = 1; i < dialogues.length; i++) {
    if (dialogues[i] === dialogues[i - 1]) {
      violations.push(`Adjacent same dialogue: "${dialogues[i]}"`);
    }
  }
  return { passed: violations.length === 0, violations };
}

export function checkSeumnida3(text) {
  const narration = getNarrationOnly(text);
  const violations = [];
  let consecutive = 0;
  for (const line of narration) {
    const sentences = splitSentences(line);
    for (const s of sentences) {
      if (s.endsWith("습니다") || s.endsWith("습니다.")) {
        consecutive++;
        if (consecutive >= 3) {
          violations.push(`Three consecutive "습니다": ${s}`);
        }
      } else {
        consecutive = 0;
      }
    }
  }
  return { passed: violations.length === 0, violations };
}

export function checkEndingRepeat(text) {
  const narration = getNarrationOnly(text);
  const endings = ["지요", "어요", "을까요", "군요", "네요", "습니다"];
  const violations = [];
  const sentenceEndings = [];
  
  for (const line of narration) {
    for (const s of splitSentences(line)) {
      let matched = "other";
      for (const end of endings) {
        if (s.endsWith(end) || s.endsWith(end + ".")) {
          matched = end;
          break;
        }
      }
      sentenceEndings.push({ text: s, end: matched });
    }
  }

  let consecutive = 1;
  for (let i = 1; i < sentenceEndings.length; i++) {
    if (sentenceEndings[i].end === sentenceEndings[i - 1].end && sentenceEndings[i].end !== "other") {
      consecutive++;
      if (consecutive >= 3) {
        violations.push(`Ending "${sentenceEndings[i].end}" repeated 3 times consecutive: ${sentenceEndings[i].text}`);
      }
    } else {
      consecutive = 1;
    }
  }
  return { passed: violations.length === 0, violations };
}

export function checkDerogatory(text) {
  const insultPattern = /(?:이|저|그|계집|같은|미친|어린|독한)\s*년(?![가-힣])/gu;
  const matches = text.match(insultPattern) || [];
  const passed = matches.length <= 2;
  return {
    passed,
    violations: passed ? [] : [`Derogatory term limit exceeded: found ${matches.length} times`]
  };
}

export function checkDialogueRatio(text) {
  const dialogues = Array.from(text.matchAll(/[“"]([^”"]+)[”"]/g)).map(m => m[0]);
  const dialogueChars = dialogues.reduce((sum, d) => sum + d.length, 0);
  const totalChars = text.length;
  const ratio = totalChars > 0 ? dialogueChars / totalChars : 0;
  const passed = ratio >= 0.35;
  return {
    passed,
    violations: passed ? [] : [`Dialogue ratio ${Math.round(ratio * 100)}% is below 35%`]
  };
}

export function checkNarration500(text) {
  const blocks = text.split(/[“"][^”"]+[”"]/g);
  const violations = [];
  blocks.forEach((b, idx) => {
    const len = b.trim().length;
    if (len > 500) {
      violations.push(`Narration block ${idx + 1} exceeds 500 characters: ${len} chars`);
    }
  });
  return { passed: violations.length === 0, violations };
}

export function checkDoubleConjunction(text) {
  const sentences = splitSentences(text);
  const patterns = [
    { regex: /그렇다면.*면/u, label: "이중 조건절" },
    { regex: /그리고.*그리고/u, label: "그리고 반복" },
    { regex: /그래서.*그래서/u, label: "그래서 반복" },
    { regex: /하지만.*하지만/u, label: "하지만 반복" }
  ];
  const violations = [];
  sentences.forEach(s => {
    patterns.forEach(p => {
      if (p.regex.test(s)) {
        violations.push(`${p.label}: ${s}`);
      }
    });
  });
  return { passed: violations.length === 0, violations };
}

export function checkTimeRedundancy(text) {
  const timeGroups = [
    ["삼 년", "3년", "봄이 세 번", "세 해"],
    ["일 년", "1년", "한 해"],
    ["하루", "한 날"]
  ];
  const violations = [];
  timeGroups.forEach(group => {
    const positions = [];
    group.forEach(term => {
      let idx = text.indexOf(term);
      while (idx !== -1) {
        positions.push({ pos: idx, term });
        idx = text.indexOf(term, idx + 1);
      }
    });
    positions.sort((a, b) => a.pos - b.pos);
    for (let i = 1; i < positions.length; i++) {
      if (positions[i].pos - positions[i - 1].pos < 200) {
        violations.push(`Time redundancy: "${positions[i - 1].term}" and "${positions[i].term}" within 200 chars`);
      }
    }
  });
  return { passed: violations.length === 0, violations };
}

export function checkLongSentences(text) {
  const sentences = splitSentences(text);
  const longCount = sentences.filter(s => s.length > 25).length;
  const ratio = sentences.length > 0 ? longCount / sentences.length : 0;
  const passed = ratio <= 0.20;
  return {
    passed,
    violations: passed ? [] : [`Too many long sentences: ${longCount}/${sentences.length} (${Math.round(ratio * 100)}%)`]
  };
}

export function performAllChecks(text) {
  const checks = [
    { name: "Hanja check", res: checkHanja(text) },
    { name: "Meta info check", res: checkMeta(text) },
    { name: "Smart quotes check", res: checkQuotePairs(text) },
    { name: "Adjacent same dialogue check", res: checkAdjacentSameDialogue(text) },
    { name: "습니다 3연속 check", res: checkSeumnida3(text) },
    { name: "Ending repeat check", res: checkEndingRepeat(text) },
    { name: "Derogatory terms limit check", res: checkDerogatory(text) },
    { name: "Dialogue ratio check", res: checkDialogueRatio(text) },
    { name: "Narration 500 chars limit check", res: checkNarration500(text) },
    { name: "Double conjunction check", res: checkDoubleConjunction(text) },
    { name: "Time redundancy check", res: checkTimeRedundancy(text) },
    { name: "Long sentences check", res: checkLongSentences(text) }
  ];

  const allPassed = checks.every(c => c.res.passed);
  return {
    gateStatus: allPassed ? "pass" : "warning",
    checks: checks.map(c => ({
      name: c.name,
      passed: c.res.passed,
      violations: c.res.violations
    }))
  };
}
