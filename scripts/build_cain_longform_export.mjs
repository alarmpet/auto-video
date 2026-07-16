#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";

const root = "C:/Users/petbl/auto-video";
const slug = "gguljam-bible-cain-envy-60min-001";
const exportDir = join(root, "exports", slug);
mkdirSync(exportDir, { recursive: true });

const title = "자면서 듣는 성경 이야기. 카인이 동생을 미워한 마음의 뿌리 | 질투와 비교의 심리";
const visualStyle = [
  "strict pure black and white only",
  "grayscale biblical oil painting",
  "heavy brush texture",
  "cinematic chiaroscuro",
  "ancient Near Eastern atmosphere",
  "quiet sleep documentary mood",
  "no color tint",
  "no purple",
  "no blue",
  "no readable text",
].join(", ");

const chapters = [
  ["밤의 마음", "잠들기 전에는 비교가 더 크게 들립니다", "방 안의 고요", "비교는 낮의 사건보다 밤의 해석에서 자주 커집니다"],
  ["땅을 가는 사람", "카인은 먼저 노력하는 사람으로 보아야 합니다", "거친 흙", "인정 욕구는 수고가 길수록 더 예민해집니다"],
  ["들판의 형제", "아벨은 경쟁자가 되기 전에 한 사람의 형제였습니다", "멀리 보이는 양 떼", "비교는 타인을 사람보다 상징으로 바꾸어 버립니다"],
  ["제사의 순간", "같은 자리에서도 마음은 서로 다른 방향을 봅니다", "두 개의 제단", "평가 불안은 사건 하나를 존재 전체의 판결처럼 느끼게 합니다"],
  ["낮아진 얼굴", "거절감은 얼굴과 어깨에 먼저 내려앉습니다", "그늘진 얼굴", "수치심은 내가 실패했다가 아니라 내가 부족하다고 속삭입니다"],
  ["문 앞의 그림자", "분노는 문 앞에 엎드린 채 기다립니다", "어두운 문턱", "감정은 죄가 아니지만 방치된 감정은 길을 요구합니다"],
  ["들로 가는 길", "말하지 못한 마음은 조용한 장소를 찾습니다", "좁은 들길", "회피와 침묵은 갈등을 줄이는 듯 보이지만 마음을 좁힙니다"],
  ["빈 들판", "상처의 결과는 사건이 끝난 뒤에도 남습니다", "비어 있는 흙", "책임 회피는 잠깐 숨게 하지만 관계의 소리를 지우지 못합니다"],
  ["나의 아우", "하나님의 질문은 정죄보다 먼저 깨어남을 부릅니다", "넓은 들판 앞의 사람", "책임은 무거운 단어지만 회복의 첫 문이기도 합니다"],
  ["비교의 구조", "질투는 사랑받고 싶은 마음이 뒤틀린 모습일 수 있습니다", "서로 다른 돌무더기", "사회 비교는 타인의 기쁨을 내 결핍의 증거로 읽게 합니다"],
  ["찾아오는 빛", "성경의 질문은 어두운 마음을 버려두지 않습니다", "문틈의 빛", "회복은 감정을 없애는 것이 아니라 감정에 이름을 붙이는 데서 시작됩니다"],
  ["오늘의 들판", "카인의 이야기는 오래된 시대가 아니라 오늘의 마음에도 있습니다", "현대처럼 느껴지는 고대 들판", "우리는 숫자와 칭찬과 시선 앞에서 쉽게 작아집니다"],
  ["질투를 내려놓는 밤", "부러운 마음을 미워하기 전에 그 밑의 두려움을 봅니다", "물 위의 작은 돌", "감정을 인정하면 감정이 명령이 아니라 신호가 됩니다"],
  ["형제를 다시 보기", "상대는 내 가치를 빼앗는 사람이 아니라 자기 길을 걷는 사람입니다", "같은 별 아래의 두 천막", "공감은 비교의 날카로운 모서리를 조금 무디게 만듭니다"],
  ["새벽의 들판", "잠들기 전 우리는 작은 돌 하나를 내려놓습니다", "밝아오는 지평선", "오늘 밤의 목표는 완벽한 결론이 아니라 조금 부드러워진 마음입니다"],
];

const sceneAngles = [
  ["첫 장면", "조용히 문을 엽니다", "지금 마음에 떠오르는 얼굴을 억지로 밀어내지 않습니다"],
  ["배경", "천천히 뒤로 물러서 봅니다", "사건을 크게 만들었던 해석을 다시 살펴봅니다"],
  ["인물의 마음", "카인의 속도를 따라갑니다", "그가 왜 그렇게 예민해졌는지 정죄보다 이해로 접근합니다"],
  ["현대의 거울", "우리의 하루와 연결해 봅니다", "메시지 하나, 칭찬 하나, 비교 하나가 마음을 흔드는 방식을 봅니다"],
  ["위로의 문장", "마음을 조금 낮은 목소리로 불러 봅니다", "부끄러운 감정도 알아차림 안에서는 조금 안전해집니다"],
  ["다음 장면으로", "결론을 서두르지 않습니다", "오늘 밤은 대답보다 조용한 질문을 품고 넘어갑니다"],
];

const paragraphOpeners = [
  "이 밤의 첫 숨에서",
  "흙 냄새가 남은 장면 앞에서",
  "형제의 거리가 조용히 벌어질 때",
  "제단의 연기가 낮게 올라갈 때",
  "카인의 얼굴이 어두워지는 순간",
  "문턱에 선 마음을 바라보면",
  "들로 향하는 발걸음 사이에서",
  "빈 들판의 침묵을 지나며",
  "질문이 바람처럼 다가올 때",
  "비교의 그림자가 길어질 때",
  "작은 빛이 다시 찾아올 때",
  "오늘 우리의 하루를 떠올리면",
  "손 안의 작은 돌을 내려놓듯",
  "아벨을 다시 한 사람으로 보면",
  "새벽이 들판 끝에 닿기 전에",
];

const closingQuestions = [
  "나는 지금 누구의 기쁨 앞에서 내 가치가 줄어든다고 느끼고 있을까요.",
  "내가 정말 미워한 것은 그 사람이었을까요, 아니면 밀려난 것 같은 내 마음이었을까요.",
  "오늘 내 얼굴을 낮아지게 만든 말은 무엇이었을까요.",
  "인정받고 싶은 마음을 조금 더 부드럽게 말한다면 어떤 문장이 될까요.",
  "비교가 사라지지는 않아도, 그 비교를 따라가지 않을 작은 선택은 무엇일까요.",
  "잠들기 전 하나님 앞에 내려놓고 싶은 이름 없는 감정은 무엇일까요.",
];

function paragraphFor(chapter, chapterIndex, sceneIndex) {
  const [chapterTitle, thesis, image, psychology] = chapter;
  const [sceneTitle, movement, practice] = sceneAngles[sceneIndex];
  const globalIndex = chapterIndex * sceneAngles.length + sceneIndex;
  const opener = paragraphOpeners[(chapterIndex + sceneIndex) % paragraphOpeners.length];
  const questionBase = closingQuestions[(chapterIndex * 2 + sceneIndex) % closingQuestions.length]
    .replace(/[.?!]$/, "");
  const question = `${questionBase}, ${chapterTitle}의 ${sceneTitle} 앞에서 조용히 물어볼 수 있을까요.`;
  const withContext = (sentence, prefix) => {
    const body = String(sentence).replace(/[.?!]\s+/g, ", ").replace(/[.?!]$/, "");
    return `${prefix}, ${chapterTitle}의 ${sceneTitle}에서는 ${body}.`;
  };
  const caution = [
    "그를 처음부터 멀리 있는 악인으로만 밀어내면, 이야기의 가장 인간적인 떨림을 놓치게 됩니다.",
    "그를 단번에 정죄해 버리면, 우리 안에도 숨어 있는 인정 욕구의 결을 보지 못합니다.",
    "그를 낯선 옛사람으로만 세워 두면, 비교 앞에서 흔들리는 우리의 밤도 설명되지 않습니다.",
    "그를 괴물로만 부르면 잠시 편해지지만, 성경이 보여 주는 마음의 경고는 희미해집니다.",
    "그를 변명하려는 것이 아니라, 무너지는 마음이 어떤 길로 가는지 차분히 살피려는 것입니다.",
    "그를 이해한다는 말은 죄를 가볍게 만든다는 뜻이 아니라, 위험한 마음을 더 일찍 알아차린다는 뜻입니다.",
  ][globalIndex % 6];
  const modernMirror = [
    "우리도 메시지 하나에 마음이 밝아지고, 무심한 표정 하나에 하루가 길게 가라앉을 때가 있습니다.",
    "오늘의 비교는 들판이 아니라 휴대폰 화면과 회의실, 가족의 말투 속에서 조용히 자랍니다.",
    "가까운 사람의 좋은 소식이 기쁘면서도 이상하게 내 부족함을 찌르는 밤이 있습니다.",
    "칭찬받지 못한 수고는 마음속에서 쉽게 억울함으로 바뀌고, 억울함은 누군가를 향한 날로 변합니다.",
    "나만 제자리인 것 같은 느낌은 사실보다 크게 번지고, 그 번짐이 관계의 색을 바꾸기도 합니다.",
    "작은 비교가 반복되면 우리는 상대를 있는 그대로 보기보다 내 결핍을 비추는 거울로 보게 됩니다.",
  ][(globalIndex + 2) % 6];
  const naming = [
    "여기에는 서운함과 부러움, 인정받고 싶은 마음이 함께 놓여 있을 수 있습니다.",
    "그 밑에는 사랑에서 밀려난 것 같은 두려움과 애써도 보이지 않는다는 피로가 숨어 있을 수 있습니다.",
    "마음의 이름은 하나가 아닐 수 있습니다. 질투, 수치심, 외로움이 한 문 안에 같이 서 있을 때도 있습니다.",
    "감정을 정확히 부르면 감정은 조금 덜 무서워집니다. 이름 붙은 마음은 더 이상 어둠 속에서만 자라지 않습니다.",
    "부끄러운 마음이라고 해서 곧바로 숨길 필요는 없습니다. 알아차린 마음은 이미 멈춰 설 자리를 찾기 시작합니다.",
    "오늘 밤 우리는 해결보다 인식을 먼저 택합니다. 마음이 어디서 시작됐는지 아는 것만으로도 숨이 조금 느려집니다.",
  ][(globalIndex + 4) % 6];
  const detail = [
    `${opener}, 우리는 ${chapterTitle}이라는 장면을 ${sceneTitle}의 자리에서 바라보며 ${thesis}라는 질문을 낮게 붙듭니다.`,
    withContext(`${movement} 그리고 ${psychology}`, "천천히 보면"),
    withContext(`${modernMirror} ${practice}`, "오늘의 거울로 옮겨오면"),
    question,
  ];
  return detail.join(" ");
}

const scenes = [];
const chapterRecords = [];
let order = 1;
for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
  const chapter = chapters[chapterIndex];
  const sceneOrders = [];
  for (let sceneIndex = 0; sceneIndex < sceneAngles.length; sceneIndex += 1) {
    const narration = paragraphFor(chapter, chapterIndex, sceneIndex);
    scenes.push({
      order,
      chapter: chapter[0],
      sceneTitle: sceneAngles[sceneIndex][0],
      narration,
    });
    sceneOrders.push(order);
    order += 1;
  }
  chapterRecords.push({
    title: chapter[0],
    scene_orders: sceneOrders,
    focus: chapter[1],
    psychology: chapter[3],
  });
}

const script = scenes.map((scene) => scene.narration).join("\n\n");
const quality = assertLongformScriptQuality(script, {
  maxRepeatedStart: 3,
  maxRepeatedSentence: 2,
  minParagraphs: 90,
  nearDuplicateThreshold: 0.82,
  maxNearDuplicateParagraphs: 8,
});
if (!quality.ok) {
  console.error(JSON.stringify(quality, null, 2));
  throw new Error("Longform script quality gate failed");
}

const production = {
  project: {
    channel: "gguljam-bible",
    slug,
    title,
    target_minutes: 60,
    audience: "sleep-friendly Bible psychology for general listeners",
  },
  script: {
    path: "script.txt",
    tone: "quiet, reflective, comforting, non-preachy",
    meaningful_chars: script.replace(/\s+/g, "").length,
    quality,
  },
  render: {
    engine: "hermes-studio",
    manual_storyboard: "hermes-manual-storyboard.md",
    target_seconds: 3600,
    visual_mode: "contextual-keyframes",
    style_preset: "calm-scripture",
    orientation: "landscape",
  },
  visual_style: {
    keywords: visualStyle,
    avoid: "stickman presenter, infographic board, red arrows, speech bubbles, large text labels, bright saturated colors, modern UI symbols, fast action, horror or gore",
  },
};

const description = [
  title,
  "",
  "잠들기 전 조용히 듣는 성경 속 마음 이야기입니다.",
  "카인과 아벨의 이야기를 질투, 비교, 인정 욕구, 수치심의 관점에서 차분하게 풀어봅니다.",
  "",
  "00:00 프롤로그",
  "성경 공부가 낯선 분도 부담 없이 들을 수 있도록, 정죄보다 이해와 위로를 우선합니다.",
].join("\n");

writeFileSync(join(exportDir, "script.txt"), script + "\n", "utf8");
writeFileSync(join(exportDir, "chapters.json"), JSON.stringify(chapterRecords, null, 2), "utf8");
writeFileSync(join(exportDir, "production.json"), JSON.stringify(production, null, 2), "utf8");
writeFileSync(join(exportDir, "youtube_description.txt"), description + "\n", "utf8");

console.log(JSON.stringify({
  exportDir,
  scenes: scenes.length,
  chapters: chapterRecords.length,
  meaningfulChars: production.script.meaningful_chars,
}, null, 2));
