const SAUL_DAVID_RULES = [
  {
    re: /창으로\s*다윗|다윗을\s*치려|손에\s*든\s*창|사무엘상\s*19\s*(?:장|:)\s*(?:9|10)/u,
    kind: "biblical_conflict",
    event: "Saul's suspicion turns toward violence against David",
    characters: ["Saul", "David"],
    required: [
      "spear near Saul's hand",
      "David in danger",
      "royal chamber tension",
    ],
  },
  {
    re: /굴|겉옷\s*자락|옷자락.*베었|사무엘상\s*24/u,
    kind: "scripture_event",
    event: "David spares Saul in the cave",
    characters: ["Saul", "David"],
    required: [
      "dark cave interior",
      "cut edge of Saul's robe",
      "David showing restraint",
    ],
  },
  {
    re: /(?=.*(?:사울|다윗))(?:주목|눈여겨|의심|두려워|사무엘상\s*18\s*(?:장|:)\s*(?:8|9))/u,
    kind: "scripture_event",
    event: "Saul begins watching David with suspicion",
    characters: ["Saul", "David"],
    required: [
      "Saul watching David with suspicion",
      "distant David",
      "palace corridor tension",
    ],
  },
  {
    re: /여인들이\s*노래|노래하여\s*이르되|사울이\s*죽인\s*자는\s*천천|다윗은\s*만만|사무엘상\s*18\s*(?:장|:)\s*7/u,
    kind: "scripture_event",
    event: "Saul hears women comparing him with David after battle",
    characters: ["Saul", "David"],
    required: [
      "Saul hearing women sing",
      "David praised in the distance",
      "public comparison song",
    ],
  },
  {
    re: /사울[\s\S]*다윗|다윗[\s\S]*사울/u,
    kind: "scripture_event",
    event: "Saul and David are in relational tension",
    characters: ["Saul", "David"],
    required: [
      "Saul and David separated by palace shadows",
      "relational tension",
      "comparison pressure",
    ],
  },
];

const PSYCHOLOGY_RULES = [
  {
    re: /칭찬|인정|비교|자리를\s*빼앗|작아|열등감/u,
    kind: "modern_psychology",
    event: "comparison anxiety becomes visible in relationship space",
    characters: [],
    required: [
      "one person praised while another withdraws",
      "empty-feeling seat",
      "defensive posture",
      "comparison anxiety made visible",
    ],
  },
  {
    re: /방어|자기방어|공격|위협|의심/u,
    kind: "modern_psychology",
    event: "self-defense hardens into threat",
    characters: [],
    required: [
      "defensive posture",
      "two people separated by shadow",
      "fear turning into control",
    ],
  },
];

const ANCHOR_LEXICON = [
  [/사울/u, "Saul"],
  [/다윗/u, "David"],
  [/창/u, "spear"],
  [/수금/u, "lyre"],
  [/왕궁|궁/u, "royal chamber"],
  [/여인|노래/u, "women singing after battle"],
  [/천천|만만/u, "public comparison song"],
  [/굴/u, "cave"],
  [/겉옷|옷자락/u, "cut edge of Saul's robe"],
  [/시기|질투/u, "jealous comparison"],
  [/두려워/u, "fear of losing place"],
  [/인정/u, "need for recognition"],
  [/비교/u, "comparison anxiety"],
];

const FORBIDDEN_GENERIC_ONLY = [
  "oil lamp",
  "family tent",
  "empty sleeping mat",
  "generic lone man",
  "generic dark road",
];

export function classifyVisualBeat(narration = "") {
  const text = String(narration || "");
  const eventRule = SAUL_DAVID_RULES.find((rule) => rule.re.test(text));
  if (eventRule) return eventRule.kind;
  const psychologyRule = PSYCHOLOGY_RULES.find((rule) => rule.re.test(text));
  if (psychologyRule) return psychologyRule.kind;
  return "reflective_bridge";
}

export function extractVisualAnchors(narration = "") {
  const text = String(narration || "");
  const anchors = [];
  for (const [re, value] of ANCHOR_LEXICON) {
    if (re.test(text) && !anchors.includes(value)) anchors.push(value);
  }
  return anchors;
}

export function buildVisualBeat({ narration = "", order = 1 } = {}) {
  const text = String(narration || "");
  const eventRule = SAUL_DAVID_RULES.find((rule) => rule.re.test(text));
  const psychologyRule = PSYCHOLOGY_RULES.find((rule) => rule.re.test(text));
  const rule = eventRule || psychologyRule || {
    kind: "reflective_bridge",
    event: "quiet reflective transition grounded in the previous biblical idea",
    characters: [],
    required: ["visible emotional distance", "quiet relational tension"],
  };
  const anchors = extractVisualAnchors(text);
  const requiredPromptTerms = unique([
    ...(rule.required || []),
    ...anchors.filter((anchor) => !(rule.required || []).some((term) => term.includes(anchor))),
  ]).slice(0, 8);
  return {
    order: Number(order) || 1,
    narration: text,
    kind: rule.kind,
    event: rule.event,
    characters: rule.characters || [],
    anchors,
    requiredPromptTerms,
    forbiddenGenericOnlyTerms: FORBIDDEN_GENERIC_ONLY,
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
