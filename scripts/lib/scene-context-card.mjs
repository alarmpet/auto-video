// Scene context cards v2.
//
// v1 problem: cards were effectively TOPIC-level, not SCENE-level. One
// psychology rule matched every paragraph of a video, so all 28+ scenes got
// the same setting/posture/action/objects and the generated keyframes looked
// identical. v2 derives per-scene variation from the narration itself:
//  - concrete Korean nouns are translated into English visual details
//  - setting/action/posture rules return CANDIDATE lists, and selection
//    avoids repeating the previous scene's choice
//  - prompt compilation is deduplicated and scene-specific content leads.

const CHARACTER_RULES = [
  { re: /한나|hannah/i, value: "Hannah" },
  { re: /브닌나|peninnah/i, value: "Peninnah" },
  { re: /엘리|eli/i, value: "Eli" },
  { re: /엘리야|elijah/i, value: "Elijah" },
  { re: /요셉|joseph/i, value: "Joseph" },
  { re: /사울|saul/i, value: "Saul" },
  { re: /다윗|david/i, value: "David" },
  { re: /모세|moses/i, value: "Moses" },
  { re: /이세벨|jezebel/i, value: "Jezebel" },
  { re: /야곱|jacob/i, value: "Jacob" },
  { re: /(^|[\s"'“‘(])에서(?:와|는|가|를|의|에게|보다|와의)?|esau/i, value: "Esau" },
  { re: /리브가|rebekah/i, value: "Rebekah" },
  { re: /이삭|isaac/i, value: "Isaac" },
  { re: /카인|cain/i, value: "Cain" },
  { re: /아벨|abel/i, value: "Abel" },
  { re: /아담|adam/i, value: "Adam" },
  { re: /하와|이브|eve/i, value: "Eve" },
  { re: /라반|laban/i, value: "Laban" },
  { re: /라헬|rachel/i, value: "Rachel" },
  { re: /레아|leah/i, value: "Leah" },
];

const PSYCHOLOGY_RULES = [
  {
    re: /상처|작은 말|한마디|무심코|오해|예민|민감|눈물|조롱|sensitive|wounded|misunderstood/i,
    concept: "sensitive heart, wounded by small words, and longing to be understood",
    emotion: "tender, easily hurt, lonely, and quietly seeking safety",
    objects: ["small oil lamp", "temple doorway", "folded hands"],
    required: ["sensitive heart", "small words", "quiet hurt"],
  },
  {
    re: /번아웃|탈진|지치|소진|무너|외로움|burnout|exhaustion|loneliness/i,
    concept: "burnout, loneliness, and collapse after sustained effort",
    emotion: "deeply tired, isolated, and quietly longing for comfort",
    objects: ["broom tree", "charcoal bread", "desert ground"],
    required: ["burnout", "exhaustion", "loneliness"],
  },
  {
    re: /질투|미워|시기|envy/i,
    concept: "envy and wounded comparison",
    emotion: "quiet jealousy and inner shame",
    objects: ["stone field", "distant altar", "shadowed hands"],
    required: ["envy", "comparison"],
  },
  {
    re: /인정|사랑받|선택|비교|recognition|comparison/i,
    concept: "need for recognition and comparison anxiety",
    emotion: "loved but insecure",
    objects: ["oil lamp", "family tent", "empty sleeping mat"],
    required: ["recognition anxiety", "comparison anxiety"],
  },
  {
    re: /선악과|먹지 말라|금지|욕망|forbidden/i,
    concept: "forbidden desire and psychological reactance",
    emotion: "curiosity mixed with fear",
    objects: ["forbidden fruit", "tree branch", "garden shadow"],
    required: ["forbidden desire", "psychological reactance"],
  },
  {
    re: /불안|두려|버림|외로|anxiety|abandonment/i,
    concept: "anxiety and fear of abandonment",
    emotion: "anxious but quietly searching",
    objects: ["distant tent light", "night road", "folded cloak"],
    required: ["anxiety", "fear of abandonment"],
  },
  {
    re: /수치|부끄|숨|shame|hiding/i,
    concept: "shame and the urge to hide",
    emotion: "exposed and quietly ashamed",
    objects: ["deep shadow", "turned back", "covered face"],
    required: ["shame", "hiding"],
  },
  {
    re: /속임|거짓|가장|deception|disguise/i,
    concept: "deception and the divided self",
    emotion: "tense and conflicted",
    objects: ["borrowed garment", "dim doorway", "half-lit face"],
    required: ["deception", "divided self"],
  },
  {
    re: /회복|위로|용서|화해|안식|restoration|comfort/i,
    concept: "slow restoration and quiet acceptance",
    emotion: "weary but comforted",
    objects: ["first dawn light", "open hands", "still water"],
    required: ["restoration", "acceptance"],
  },
];

// Concrete Korean noun -> English visual detail. This is the main source of
// per-scene variation: whatever the narration actually mentions shows up in
// the image prompt as a concrete, renderable element.
const DETAIL_LEXICON = [
  [/한나|hannah/i, "Hannah praying silently in the temple"],
  [/브닌나|peninnah/i, "distant rival voice beyond a family table"],
  [/엘리|eli/i, "elder priest silhouette near the temple doorway"],
  [/성전|기도|하나님/i, "quiet temple doorway and stone floor"],
  [/작은 말|한마디|무심코/i, "small spoken words felt like a dark ripple in the room"],
  [/오해|이해/i, "two figures separated by a quiet misunderstanding"],
  [/눈물|울음|통곡/i, "tear falling onto folded hands"],
  [/식탁|비교|조롱/i, "low family table with one empty-feeling place"],
  [/로뎀나무|broom tree/i, "solitary broom tree in a barren wilderness"],
  [/숯불|숯|charcoal/i, "glowing charcoal embers on desert ground"],
  [/호렙|시내산|horeb|sinai/i, "vast mountain face under open sky"],
  [/갈멜|갈멜산|carmel/i, "Mount Carmel ridge beneath a dramatic sky"],
  [/세미한 소리|still small voice/i, "quiet mountain cave opening in still air"],
  [/이세벨|jezebel/i, "threatening shadow cast across a distant path"],
  [/장막|천막/, "woven goat-hair tent"],
  [/등불|등잔|호롱/, "small clay oil lamp"],
  [/식탁|밥상|식사|먹/, "simple shared meal on a low table"],
  [/들판|밭|들에서/, "wide open field"],
  [/발꿈치/, "newborn hand grasping a heel"],
  [/팥죽|죽/, "steaming pot of red lentil stew"],
  [/사냥|활|화살/, "hunting bow and quiver resting against a post"],
  [/털|염소/, "goatskin draped over an arm"],
  [/축복/, "elderly father's trembling hands raised in blessing"],
  [/우물/, "ancient stone well"],
  [/돌베개|돌을 베/, "rough stone used as a pillow"],
  [/사다리|층계/, "vast stairway of light reaching into the night sky"],
  [/별|밤하늘/, "field of stars over a dark horizon"],
  [/달|달빛/, "pale moonlight"],
  [/새벽|동이 트/, "first grey light of dawn"],
  [/강|얍복|나루/, "dark river ford at night"],
  [/씨름|붙들/, "two figures wrestling in darkness"],
  [/환도뼈|절뚝/, "man limping as the sun rises"],
  [/양|양떼/, "flock of sheep resting on a hillside"],
  [/지팡이/, "worn shepherd's staff"],
  [/길|여정|떠나|도망/, "long dusty road stretching to the horizon"],
  [/눈물|울/, "face wet with quiet tears"],
  [/포옹|안아|껴안/, "two brothers embracing"],
  [/제단|제물/, "low stone altar with thin smoke"],
  [/문|문턱|입구/, "shadowed doorway threshold"],
  [/손|두 손/, "weathered hands in close view"],
  [/그릇|항아리|물동이/, "clay water jar"],
  [/불|모닥불|화덕/, "small fire burning low"],
  [/사울/, "Saul hearing women sing"],
  [/다윗/, "David praised in the distance"],
  [/여인|노래/, "women singing after battle"],
  [/천천|만만/, "public comparison song"],
  [/창/, "spear near Saul's hand"],
  [/수금/, "lyre beside David"],
  [/왕궁|궁/, "tense royal chamber"],
  [/굴/, "dark cave interior"],
  [/겉옷|옷자락/, "cut edge of Saul's robe"],
  [/어둠|밤/, "deep surrounding darkness"],
  [/침묵|고요/, "utter stillness"],
  [/계산|숫자|세어/, "figure staring into darkness, lost in silent counting"],
  [/이름/, "a name spoken in the dark"],
];

// Setting candidates. Rules can match multiple; selection rotates away from
// the previous scene's setting to prevent 28 identical backdrops.
const SETTING_RULES = [
  {
    re: /장막|천막|집|가족|어머니|아버지/,
    values: [
      "inside an ancient family tent lit by a single oil lamp",
      "at the open entrance of a family tent under night sky",
      "beside a low fire in the corner of a darkened tent",
      "outside the family tent, looking back at its glowing seams",
    ],
  },
  {
    re: /들판|밭|제물|제단|사냥/,
    values: [
      "in a quiet biblical field under pale dawn",
      "at the edge of a harvested field with long shadows",
      "on a low hill overlooking scattered flocks",
    ],
  },
  {
    re: /광야|사막|모래|돌베개|벧엘|wilderness|desert/,
    values: [
      "in a barren silent wilderness under a night sky",
      "among cold scattered stones in open wilderness",
      "under an immense starfield in empty land",
    ],
  },
  {
    re: /길|떠나|도망|여행|걸어|journey|road/,
    values: [
      "walking slowly along a quiet dusty road",
      "pausing at a fork in a long empty road",
      "a distant lone traveler on a ridgeline path",
    ],
  },
  {
    re: /우물|물|강|얍복/,
    values: [
      "beside an ancient stone well at dusk",
      "at a dark river ford under low mist",
    ],
  },
  {
    re: /동산|나무|열매|선악과|에덴|eden|fruit/,
    values: [
      "inside a shadowed garden near a single fruit tree",
      "beneath wide branches heavy with fruit",
    ],
  },
  {
    re: /식탁|밥상|죽|먹/,
    values: [
      "at a low table with a simple shared meal",
      "beside a hearth where a pot of stew steams",
    ],
  },
];

const POSTURE_RULES = [
  { re: /불안|두려|숨|비교|인정|흔들/, values: ["hands folded anxiously, posture showing hesitation", "shoulders drawn inward, glancing sideways", "fingers worrying the hem of a robe"] },
  { re: /슬픔|외로|버림|상처|미워|눈물/, values: ["looking downward, solemn and restrained posture", "head bowed, hand pressed to chest", "sitting alone, arms wrapped around knees"] },
  { re: /기도|바라|원하|축복|기다/, values: ["looking toward a soft distant light, posture of longing", "kneeling with open upturned palms", "standing still, face lifted to the night sky"] },
  { re: /평안|위로|감사|쉼|회복/, values: ["standing with open hands, peaceful and composed posture", "resting against a tree, breathing slowly", "seated with a faint easing of the shoulders"] },
];

const ACTION_RULES = [
  { re: /비교|인정|선택|사랑받/, values: ["quietly sitting apart from the family circle", "watching the family from a threshold, half in shadow", "tending a small lamp while others sleep"] },
  { re: /속임|옷|털|축복/, values: ["standing before an elderly father with visible hesitation", "pausing with a borrowed garment half-donned", "hovering a hand over a covered dish, unable to move"] },
  { re: /떠나|도망|광야|길/, values: ["walking away while carrying a small bundle", "looking back once at a distant tent light", "setting a stone upright at first light"] },
  { re: /제물|제단|질투/, values: ["standing apart from a distant altar", "watching smoke rise from another's offering"] },
  { re: /선악과|금지|먹지/, values: ["pausing before touching a fruit branch", "withdrawing a hand from low-hanging fruit"] },
  { re: /씨름|붙들|강/, values: ["wrestling with an unknown figure in darkness", "gripping and refusing to let go until dawn"] },
  { re: /포옹|화해|용서/, values: ["two brothers embracing on open ground", "running forward with open arms"] },
];

const DEFAULT_RULE = {
  concept: "inner conflict and quiet self-reflection",
  emotion: "solemn and contemplative",
  objects: ["night sky", "stone path", "simple robe"],
  required: ["inner conflict", "self-reflection"],
};

const DEFAULT_SETTINGS = [
  "in a quiet ancient Near Eastern night scene",
  "under a wide dark sky over sparse land",
  "in a dim interior lit by a single flame",
];
const DEFAULT_POSTURES = ["posture of quiet self-reflection", "standing motionless, eyes half closed"];
const DEFAULT_ACTIONS = ["standing still in a moment of inner conflict", "slowly turning toward a faint light"];
const NEGATIVE_TERMS = ["purple", "blue", "color tint", "readable text", "subtitle", "watermark", "modern clothing"];

export function buildSceneContextCard({ narration = "", order = 1, topic = "", previous = null, visualBeat = null } = {}) {
  const text = String(narration || "");
  const topicText = String(topic || "");
  const combined = `${text} ${topicText}`;
  const seed = hashText(text) + Number(order || 1);

  const characters = unique(CHARACTER_RULES.filter((item) => item.re.test(text)).map((item) => item.value));
  const fallbackCharacters = characters.length
    ? characters
    : unique(CHARACTER_RULES.filter((item) => item.re.test(combined)).map((item) => item.value));
  const biblicalCharacters = unique([
    ...fallbackCharacters,
    ...(Array.isArray(visualBeat?.characters) ? visualBeat.characters : []),
  ]);

  // Psychology: match against THIS scene's narration first; topic only as fallback.
  const psychology = PSYCHOLOGY_RULES.find((item) => item.re.test(text))
    || PSYCHOLOGY_RULES.find((item) => item.re.test(combined))
    || DEFAULT_RULE;

  const setting = pickVaried(collectCandidates(SETTING_RULES, text, DEFAULT_SETTINGS), seed, previous?.setting);
  const posture = pickVaried(collectCandidates(POSTURE_RULES, text, DEFAULT_POSTURES), seed >> 1, previous?.posture);
  const action = pickVaried(collectCandidates(ACTION_RULES, text, DEFAULT_ACTIONS), seed >> 2, previous?.action);

  // Scene-specific concrete details translated from the narration. These are
  // what actually differentiate one image from the next.
  const sceneDetails = extractSceneDetails(text, 4);
  const biblicalEvent = visualBeat?.event || inferBiblicalEvent(combined);
  const visualFocus = buildVisualFocus({
    text,
    biblicalCharacters,
    details: sceneDetails,
    psychology,
    event: biblicalEvent,
  });
  const beatTerms = Array.isArray(visualBeat?.requiredPromptTerms)
    ? visualBeat.requiredPromptTerms.slice(0, 5)
    : [];
  for (const term of beatTerms.toReversed()) {
    if (term && !visualFocus.primaryTerms.includes(term)) visualFocus.primaryTerms.unshift(term);
  }
  const subject = visualFocus.primaryTerms.length
    ? visualFocus.primaryTerms.join(", ")
    : (biblicalCharacters.length ? biblicalCharacters.join(" and ") : "quiet biblical inner-life moment");
  const visualAnchor = `${subject} ${setting}, ${posture}, ${action}`;

  const keywords = extractKoreanKeywordsClean(text);
  const sourceAnchorWords = new Set(["야곱", "에서", "카인", "아벨", "아담", "하와", "사랑", "인정", "비교", "질투", "불안", "축복", "선악과", "광야", "장막", "가족"]);
  const sourceAnchors = keywords.filter((word) => sourceAnchorWords.has(word));

  const objects = rotate(psychology.objects, seed).slice(0, 2);
  const requiredPromptTerms = unique([
    ...(visualBeat?.requiredPromptTerms || []),
    ...(visualFocus.primaryTerms || []),
    ...psychology.required,
    ...objects.slice(0, 1),
  ]);
  if (requiredPromptTerms.length === 0 && biblicalCharacters[0]) {
    requiredPromptTerms.push(biblicalCharacters[0]);
  }

  return {
    order: Number(order) || 1,
    narration: text,
    topic: topicText,
    biblicalCharacters,
    biblicalEvent,
    psychologyConcept: psychology.concept,
    emotion: psychology.emotion,
    setting,
    posture,
    action,
    visualAnchor,
    visualFocus,
    symbolicObjects: objects,
    sceneDetails,
    avoid: ["generic desert only", "random prophet portrait", "readable text", "modern clothing", "color tint"],
    keywords,
    sceneDetailCues: sceneDetails, // legacy alias (was Korean tokens; now English)
    requirements: {
      sourceAnchors,
      requiredPromptTerms,
      negativePromptTerms: NEGATIVE_TERMS,
    },
  };
}

export function compileContextPrompt({ card, style = "" } = {}) {
  const requiredTerms = card.requirements?.requiredPromptTerms?.length
    ? `required visible anchors: ${card.requirements.requiredPromptTerms.join(", ")}`
    : "";
  const focusTerms = card.visualFocus?.primaryTerms || [];
  const characterContext = (card.visualFocus?.secondaryCharacters || card.biblicalCharacters || []).join(", ");
  const leadSubject = focusTerms.length
    ? focusTerms.join(", ")
    : (characterContext || "quiet biblical inner-life moment");
  const parts = [
    // Scene-specific content FIRST so it carries weight with the image model.
    leadSubject,
    card.visualAnchor,
    ...(card.sceneDetails || []),
    card.biblicalEvent,
    characterContext && focusTerms.length ? `biblical context: ${characterContext}` : "",
    `${card.psychologyConcept} expressed through posture and composition`,
    `${card.emotion} mood`,
    ...(card.symbolicObjects || []),
    requiredTerms,
    // Shared style LAST, exactly once.
    style,
    "wide 16:9 composition",
    "no readable text",
    "no subtitle",
    "no watermark",
    "no modern clothing",
  ];
  return dedupeCommaTokens(parts.filter(Boolean).join(", "));
}

export function scorePromptContextAlignment({ card, prompt = "" } = {}) {
  const p = String(prompt || "").toLowerCase();
  const failures = [];
  for (const term of card.requirements?.requiredPromptTerms || []) {
    if (term && !p.includes(String(term).toLowerCase())) failures.push(`missing_required_prompt_term:${term}`);
  }
  for (const term of card.requirements?.negativePromptTerms || []) {
    if (term && hasForbiddenTerm(p, term)) failures.push(`negative_term_present:${term}`);
  }
  const genericOnly = /ancient desert|biblical figure|calm mood/.test(p)
    && !(card.symbolicObjects || []).some((obj) => p.includes(String(obj).toLowerCase()))
    && !(card.biblicalCharacters || []).some((name) => p.includes(String(name).toLowerCase()));
  if (genericOnly) failures.push("generic_visual_anchor");
  const score = Math.max(0, 100 - failures.length * 15);
  return { ok: failures.length === 0 && score >= 85, score, failures };
}

export function extractKoreanKeywordsClean(text) {
  return unique(String(text || "")
    .replace(/[^\p{Script=Hangul}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/(에서는|에게는|에게서|으로는|로는|에도|에서|에게|부터|까지|만큼|보다|마저|조차|은|는|이|가|을|를|과|와|으로|로|하고|처럼|마다)$/u, ""))
    .filter((word) => word.length >= 2)
    .slice(0, 16));
}

export function extractSceneDetails(text, limit = 4) {
  const details = [];
  for (const [re, value] of DETAIL_LEXICON) {
    if (re.test(text)) details.push(value);
    if (details.length >= limit) break;
  }
  return details;
}

function buildVisualFocus({ text, biblicalCharacters = [], details = [], psychology = null, event = "" }) {
  const primaryTerms = [];
  for (const detail of details) {
    if (primaryTerms.length >= 4) break;
    if (detail && !primaryTerms.includes(detail)) primaryTerms.push(detail);
  }
  for (const object of psychology?.objects || []) {
    if (primaryTerms.length >= 5) break;
    if (object && !primaryTerms.includes(object)) primaryTerms.push(object);
  }
  for (const required of psychology?.required || []) {
    if (primaryTerms.length >= 6) break;
    if (required && !primaryTerms.includes(required)) primaryTerms.push(required);
  }
  if (/세미한 소리|still small voice/i.test(text) && !primaryTerms.includes("still small voice")) {
    primaryTerms.unshift("still small voice");
  }
  if (/로뎀나무|broom tree/i.test(text) && !primaryTerms.includes("solitary broom tree in a barren wilderness")) {
    primaryTerms.unshift("solitary broom tree in a barren wilderness");
  }
  if (/호렙|horeb/i.test(text) && !primaryTerms.includes("Horeb mountain cave")) {
    primaryTerms.unshift("Horeb mountain cave");
  }
  if (/갈멜|carmel/i.test(text) && !primaryTerms.includes("Mount Carmel ridge")) {
    primaryTerms.unshift("Mount Carmel ridge");
  }
  const hasConcreteAnchor = primaryTerms.length > 0;
  return {
    mode: hasConcreteAnchor ? "context_anchor" : "character_context",
    primaryTerms: hasConcreteAnchor ? primaryTerms.slice(0, 6) : biblicalCharacters.slice(0, 2),
    secondaryCharacters: biblicalCharacters,
    event,
  };
}

function collectCandidates(rules, text, defaults) {
  const matched = rules.filter((rule) => rule.re.test(text)).flatMap((rule) => rule.values);
  return matched.length ? unique(matched) : defaults;
}

// Pick from candidates using a text-derived seed, never repeating the
// previous scene's pick when an alternative exists.
function pickVaried(candidates, seed, previousValue) {
  if (!candidates.length) return "";
  const pool = candidates.length > 1 && previousValue
    ? candidates.filter((value) => value !== previousValue)
    : candidates;
  const usable = pool.length ? pool : candidates;
  return usable[Math.abs(seed) % usable.length];
}

function rotate(values, seed) {
  if (!values?.length) return [];
  const shift = Math.abs(seed) % values.length;
  return [...values.slice(shift), ...values.slice(0, shift)];
}

function hashText(text) {
  let hash = 5381;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function dedupeCommaTokens(prompt) {
  const seen = new Set();
  const tokens = [];
  for (const raw of String(prompt).split(",")) {
    const token = raw.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens.join(", ");
}

function inferBiblicalEvent(text) {
  if (/갈멜|갈멜산|carmel/i.test(text)) return "Elijah after the victory on Mount Carmel";
  if (/로뎀나무|broom tree/i.test(text)) return "Elijah resting under the broom tree in the wilderness";
  if (/호렙|세미한 소리|still small voice|horeb/i.test(text)) return "God speaking to Elijah in a still small voice at Horeb";
  if (/이세벨|jezebel/i.test(text)) return "Elijah fleeing after Jezebel's threat";
  if (/엘리야|elijah/i.test(text)) return "Elijah in the wilderness after the great victory";
  if (/씨름|얍복/i.test(text)) return "Jacob wrestling through the night at the Jabbok ford";
  if (/사다리|벧엘|돌베개/i.test(text)) return "Jacob's dream of the stairway at Bethel";
  if (/팥죽|장자/i.test(text)) return "Esau trading his birthright for stew";
  if (/축복|염소|털/i.test(text)) return "Jacob taking the blessing before blind Isaac";
  if (/포옹|화해/i.test(text)) return "Jacob and Esau's reunion embrace";
  if (/야곱|리브가|이삭|jacob|esau|rebekah|isaac/i.test(text) || /(^|[\s"'“‘(])에서(?:와|는|가|를|의|에게|보다|와의)?/i.test(text)) return "Jacob inside Isaac's family conflict";
  if (/카인|아벨|cain|abel/i.test(text)) return "Cain and Abel before the first murder";
  if (/아담|하와|선악과|에덴|adam|eve|eden/i.test(text)) return "Adam and Eve near the forbidden fruit";
  return "quiet biblical inner-life moment";
}

function hasForbiddenTerm(prompt, term) {
  const normalizedPrompt = String(prompt || "").toLowerCase();
  const normalizedTerm = String(term || "").toLowerCase().trim();
  if (!normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`\\b${escaped}\\b`, "gi");
  for (const match of normalizedPrompt.matchAll(pattern)) {
    const before = normalizedPrompt.slice(Math.max(0, match.index - 8), match.index);
    if (!/\bno\s+$/.test(before)) return true;
  }
  return false;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

