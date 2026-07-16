const CONCRETE_CUES = [
  /장막|천막|등불|등잔|호롱|돌베개|돌|광야|강|나루|우물|식탁|밥상|팥죽|그릇|항아리|옷자락|손끝|손|발꿈치|숨소리|밤|새벽|달빛|별|길|먼지|문턱|제단|연기|불빛|모닥불|화덕|아버지|어머니|형|동생|얼굴|표정|눈물|몸|어깨|무릎|목소리|침묵/u,
];

const ABSTRACT_CUES = [
  /마음|불안|관계|문제|의미|감정|상처|위로|사랑|인정|비교|결핍|두려움|회복|평안|질문|기억|존재|가치|선택|욕구|심리|생각|해석|갈등/u,
];

const TENSION_STAGE_RULES = [
  { name: "scene", re: /장막|광야|밤|등불|돌베개|식탁|강|우물|문턱|제단|숨소리|옷자락/u },
  { name: "question", re: /왜|어떻게|무엇|질문|까요|일까요|\?/u },
  { name: "conflict", re: /불안|두려|비교|상처|속임|갈등|흔들|긴장|붙잡|사라지/u },
  { name: "turn", re: /그러나|하지만|그런데|이때|여기서|다시|마침내|결국/u },
  { name: "comfort", re: /위로|쉬어|괜찮|아닙니다|닫히지|남아|숨|안심|편안|오늘 당신/u },
];

const SECOND_PERSON_PATTERNS = [
  /여러분/u,
  /당신/u,
  /오늘 밤 .*?(우리|당신|여러분)/u,
  /느껴지지는 않을 것입니다/u,
  /적이 있다면/u,
  /괜찮습니다/u,
  /전부는 아닙니다/u,
];

export function analyzePhase3ScriptQuality(text, options = {}) {
  const source = String(text || "").trim();
  const minConcreteRatio = Number(options.minConcreteRatio ?? 0.08);
  const minConcreteHits = Number(options.minConcreteHits ?? 2);
  const maxRepeatedPointRatio = Number(options.maxRepeatedPointRatio ?? 0.28);
  const minTensionStages = Number(options.minTensionStages ?? 4);
  const minSecondPersonTouchpoints = Number(options.minSecondPersonTouchpoints ?? 3);

  const concreteness = analyzeConcreteness(source, { minConcreteRatio, minConcreteHits });
  const argumentRepetition = analyzeArgumentRepetition(source, { maxRepeatedPointRatio });
  const tensionCurve = analyzeTensionCurve(source, { minTensionStages });
  const secondPersonEmpathy = analyzeSecondPersonEmpathy(source, { minSecondPersonTouchpoints });

  const failures = [
    ...concreteness.failures.map((failure) => `concreteness:${failure}`),
    ...argumentRepetition.failures.map((failure) => `argument_repetition:${failure}`),
    ...tensionCurve.failures.map((failure) => `tension_curve:${failure}`),
    ...secondPersonEmpathy.failures.map((failure) => `second_person_empathy:${failure}`),
  ];

  return {
    ok: failures.length === 0,
    failures,
    concreteness,
    argumentRepetition,
    tensionCurve,
    secondPersonEmpathy,
  };
}

export function analyzeConcreteness(text, { minConcreteRatio = 0.08, minConcreteHits = 2 } = {}) {
  const concreteHits = countRuleHits(text, CONCRETE_CUES);
  const abstractHits = countRuleHits(text, ABSTRACT_CUES);
  const ratio = concreteHits / Math.max(1, concreteHits + abstractHits);
  const failures = [];
  if (ratio < minConcreteRatio) {
    failures.push(`concrete_ratio_${round(ratio)}_below_${minConcreteRatio}`);
  }
  if (concreteHits < minConcreteHits) {
    failures.push(`concrete_hits_${concreteHits}_below_${minConcreteHits}`);
  }
  return {
    ok: failures.length === 0,
    concreteHits,
    abstractHits,
    concreteRatio: round(ratio),
    minConcreteRatio,
    minConcreteHits,
    failures,
  };
}

export function analyzeArgumentRepetition(text, { maxRepeatedPointRatio = 0.28 } = {}) {
  const paragraphs = splitParagraphs(text);
  const normalized = paragraphs.map(normalizePoint).filter(Boolean);
  const counts = new Map();
  for (const point of normalized) counts.set(point, (counts.get(point) || 0) + 1);
  const repeated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([point, count]) => ({ point, count }));
  const repeatedParagraphs = repeated.reduce((sum, item) => sum + item.count, 0);
  const ratio = repeatedParagraphs / Math.max(1, normalized.length);
  const failures = [];
  if (ratio > maxRepeatedPointRatio) {
    failures.push(`repeated_point_ratio_${round(ratio)}_above_${maxRepeatedPointRatio}`);
  }
  return {
    ok: failures.length === 0,
    paragraphCount: paragraphs.length,
    repeatedPointRatio: round(ratio),
    maxRepeatedPointRatio,
    repeatedPoints: repeated.slice(0, 10),
    failures,
  };
}

export function analyzeTensionCurve(text, { minTensionStages = 4 } = {}) {
  const stageHits = TENSION_STAGE_RULES
    .filter((rule) => rule.re.test(text))
    .map((rule) => rule.name);
  const failures = [];
  if (stageHits.length < minTensionStages) {
    failures.push(`stage_count_${stageHits.length}_below_${minTensionStages}`);
  }
  return {
    ok: failures.length === 0,
    stageHits,
    stageCount: stageHits.length,
    minTensionStages,
    failures,
  };
}

export function analyzeSecondPersonEmpathy(text, { minSecondPersonTouchpoints = 3 } = {}) {
  const touchpoints = SECOND_PERSON_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
  const failures = [];
  if (touchpoints.length < minSecondPersonTouchpoints) {
    failures.push(`touchpoint_count_${touchpoints.length}_below_${minSecondPersonTouchpoints}`);
  }
  return {
    ok: failures.length === 0,
    touchpointCount: touchpoints.length,
    minSecondPersonTouchpoints,
    touchpoints,
    failures,
  };
}

function countRuleHits(text, rules) {
  return rules.reduce((sum, rule) => sum + (text.match(new RegExp(rule.source, "gu")) || []).length, 0);
}

function splitParagraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function normalizePoint(paragraph) {
  return String(paragraph || "")
    .replace(/[.?!,，。！？]/g, " ")
    .replace(/[^\p{Script=Hangul}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/(입니다|합니다|했습니다|였습니다|었습니다|입니다|습니다|다는|라는|으로|에서|에게|보다|처럼|까지|부터|하고|하며|은|는|이|가|을|를|과|와|도|만)$/u, ""))
    .filter((word) => word.length >= 2)
    .slice(0, 12)
    .join(" ");
}

function round(value) {
  return Number(value.toFixed(3));
}
