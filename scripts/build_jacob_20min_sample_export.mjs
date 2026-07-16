#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";
import { buildSegmentPlan, buildVisualTimelineForWindow } from "./lib/segment-plan.mjs";
import { buildSceneContextCard, compileContextPrompt, scorePromptContextAlignment } from "./lib/scene-context-card.mjs";

const root = "C:/Users/petbl/auto-video";
const args = parseArgs(process.argv.slice(2));
const slug = args.slug || "gguljam-bible-jacob-loved-anxious-20min-001";
const exportDir = join(root, "exports", slug);
mkdirSync(exportDir, { recursive: true });

const title = "자면서 듣는 성경 이야기. 야곱은 왜 사랑받고도 불안했을까 | 인정 욕구와 불안의 심리";
const targetSeconds = Number(args.targetSeconds || 1200);
const segmentPlan = buildSegmentPlan({
  targetSeconds,
  segmentMinutes: Number(args.segmentMinutes || 10),
  introSeconds: 60,
  introSceneSeconds: 6,
  bodySceneSeconds: 30,
});

const chapters = [
  {
    title: "쌍둥이의 집",
    paragraphs: [
      "이 밤에는 한 집 안에서 시작된 아주 오래된 마음의 이야기를 조용히 펼쳐 보겠습니다. 야곱과 에서의 이야기는 누가 더 옳았는지를 빠르게 가르는 이야기가 아닙니다. 사랑을 받고도 마음이 편하지 않았던 한 사람의 불안을 들여다보는 이야기입니다.",
      "성경은 야곱이 태어나기 전부터 형의 발꿈치를 붙잡고 있었다고 말합니다. 그 짧은 장면에는 앞으로 이어질 마음의 방향이 담겨 있습니다. 먼저 태어난 사람, 먼저 인정받는 사람, 먼저 자리를 차지한 사람을 향해 손을 뻗는 마음입니다.",
      "야곱은 어머니 리브가의 사랑을 받았습니다. 하지만 사랑을 받는다는 사실과 마음이 안심한다는 일은 언제나 같은 말이 아닙니다. 어떤 사람은 사랑을 받으면서도 계속 확인하고 싶어 합니다. 지금도 나를 보고 있는지, 아직도 나를 선택하는지 묻고 싶어 합니다.",
      "에서는 들판의 사람이었고, 야곱은 장막 안에 머무는 사람이었습니다. 두 사람은 다르다는 이유만으로 자주 비교의 자리에 세워졌을 것입니다. 비교는 누가 더 나은지를 말하는 것처럼 보이지만, 사실은 누가 더 사랑받는지를 묻는 마음을 깨웁니다.",
      "잠시 숨을 고르며 이 집의 공기를 떠올려 봅니다. 같은 부모, 같은 지붕, 같은 식탁 아래에서도 아이들은 서로 다른 시선으로 자랍니다. 누군가는 칭찬을 더 잘 듣고, 누군가는 조용히 눈치를 봅니다. 야곱의 불안은 바로 그 조용한 눈치에서 자라났을지 모릅니다.",
    ],
  },
  {
    title: "사랑받고도 흔들리는 마음",
    paragraphs: [
      "인정 욕구는 약한 사람에게만 생기는 마음이 아닙니다. 사랑받고 싶은 마음은 사람 안에 아주 깊이 놓여 있습니다. 다만 그 마음이 충분히 돌봄받지 못하면, 사랑을 선물로 받는 대신 증거로 모으려 합니다.",
      "야곱에게 어머니의 사랑은 분명한 힘이었을 것입니다. 그러나 그 사랑이 아버지의 축복, 장자의 자리, 형의 앞선 이름까지 대신해 주지는 못했습니다. 마음은 종종 하나를 받으면서도 받지 못한 하나를 더 크게 바라봅니다.",
      "현대 심리학에서는 이런 마음을 조건부 인정에 가까운 불안으로 설명하기도 합니다. 내가 있는 그대로 괜찮다는 감각이 약할 때, 사람은 성취나 선택이나 비교 우위를 통해 자기 자리를 확인하려 합니다. 야곱도 아마 자신의 자리를 그냥 믿기 어려웠을 것입니다.",
      "사랑받고 있으면서도 불안한 사람은 마음속에 작은 계산기를 품고 삽니다. 오늘은 누가 더 칭찬받았는지, 누가 더 귀하게 여겨졌는지, 내가 밀려난 것은 아닌지 조용히 세어 봅니다. 그 계산은 지치게 하지만 쉽게 멈추지 않습니다.",
      "그래서 이 이야기는 오래된 가족사이면서 동시에 오늘 우리의 이야기입니다. 가족 안에서, 일터에서, 친구 사이에서 우리는 가끔 묻습니다. 나는 정말 충분한 사람일까. 누군가가 나보다 먼저 선택되면, 내 자리는 사라지는 걸까.",
    ],
  },
  {
    title: "팥죽 한 그릇의 심리",
    paragraphs: [
      "어느 날 에서는 들에서 돌아와 몹시 지쳐 있었습니다. 야곱은 그 순간을 보았습니다. 형의 배고픔, 형의 급한 마음, 형이 잠시 자기 장자의 권리를 가볍게 여길 수 있는 틈을 보았습니다. 이 장면은 단순한 거래처럼 보이지만, 마음의 오래된 갈증이 섞여 있습니다.",
      "야곱은 팥죽 한 그릇으로 장자의 명분을 요구합니다. 겉으로 보면 영리한 선택입니다. 그러나 깊이 들여다보면, 영리함 뒤에는 불안이 있습니다. 이미 사랑받는 사람이라면 굳이 이렇게까지 붙잡지 않아도 될 것을 붙잡으려 했기 때문입니다.",
      "불안은 사람을 빠르게 만듭니다. 기다리면 될 일을 서두르게 하고, 말로 풀 수 있는 일을 거래로 바꾸게 합니다. 내가 정당하게 받을 수 없을 것 같다는 마음이 커지면, 사람은 때로 몰래라도 확보하려고 합니다.",
      "에서는 그 순간의 배고픔을 크게 보았고, 야곱은 오래된 결핍을 크게 보았습니다. 한 사람은 현재의 허기를 따라갔고, 한 사람은 미래의 인정을 붙잡으려 했습니다. 서로 다른 허기가 같은 식탁 위에서 만난 셈입니다.",
      "우리도 급한 마음일 때 자신에게 물어볼 수 있습니다. 지금 내가 붙잡으려는 것은 정말 필요한 것일까. 아니면 누군가에게 밀려날까 봐 두려워서 더 세게 움켜쥐는 것일까. 이 질문은 판단이 아니라 마음을 늦추는 작은 등불입니다.",
    ],
  },
  {
    title: "축복을 훔친 밤",
    paragraphs: [
      "시간이 흐르고, 이삭은 늙어 눈이 어두워졌습니다. 그는 에서에게 축복을 주려 했고, 리브가는 그 말을 듣습니다. 그리고 야곱에게 형처럼 꾸미고 들어가라고 말합니다. 집 안의 오래된 긴장이 한밤중의 속삭임처럼 움직이기 시작합니다.",
      "야곱은 망설입니다. 아버지가 만져 보면 들킬 것이라고 말합니다. 이 망설임에는 양심도 있고 두려움도 있습니다. 그러나 결국 그는 어머니의 말에 따릅니다. 인정받고 싶은 마음은 때로 스스로의 목소리보다 더 큰 목소리를 따라가게 만듭니다.",
      "그는 형의 옷을 입고, 손과 목에 털가죽을 두르고, 아버지 앞에 섭니다. 이 장면은 매우 조용하지만 마음속에서는 큰 소리가 납니다. 사랑받고 싶은 사람이 자기 얼굴을 숨긴 채 사랑을 받으러 들어가는 장면이기 때문입니다.",
      "이삭은 묻습니다. 너는 정말 내 아들 에서냐. 야곱은 그렇다고 대답합니다. 그 대답은 축복을 얻기 위한 말이었지만 동시에 불안의 씨앗이 됩니다. 속임수로 얻은 인정은 마음 깊은 곳에서 오래 안심을 주지 못합니다.",
      "사람은 가끔 진짜 나로는 부족할 것 같아 다른 얼굴을 씁니다. 더 강한 척, 더 괜찮은 척, 더 믿음 좋은 척, 더 성공한 척합니다. 하지만 가면을 쓰고 받은 박수는 이상하게도 마음을 편하게 하지 않습니다.",
    ],
  },
  {
    title: "얻었지만 도망치는 마음",
    paragraphs: [
      "야곱은 축복을 받았습니다. 그러나 그가 얻은 것은 평안이 아니었습니다. 얼마 지나지 않아 에서의 분노가 드러나고, 야곱은 집을 떠나야 했습니다. 인정받기 위해 붙잡은 것이 오히려 그를 외로운 길로 밀어낸 것입니다.",
      "불안한 마음은 무엇을 얻으면 끝날 것처럼 말합니다. 이것만 얻으면 괜찮아질 거야. 이 말만 들으면 편해질 거야. 하지만 내면의 깊은 두려움이 돌봄받지 못하면, 얻은 뒤에도 또 다른 불안이 찾아옵니다.",
      "야곱은 아버지의 축복을 받았지만 형의 얼굴을 피해야 했고, 어머니의 사랑을 받았지만 집을 떠나야 했습니다. 사랑과 축복이 모두 있었는데도 그의 밤은 길어졌습니다. 이것이 인정 욕구가 남기는 아이러니입니다.",
      "우리는 때로 누군가의 인정을 얻기 위해 너무 많은 마음을 씁니다. 그런데 막상 그 인정을 얻고 나면, 그것을 잃을까 봐 또 불안해집니다. 인정이 마음의 중심이 되면, 얻어도 편하지 않고 잃으면 무너질 것 같습니다.",
      "그래서 이 이야기는 우리에게 조용히 묻습니다. 정말 필요한 것은 더 많은 확인일까. 아니면 확인을 계속 요구하는 마음을 안아 주는 일일까. 야곱의 도망길은 실패의 길이면서 동시에 마음이 새롭게 배울 수 있는 길이 됩니다.",
    ],
  },
  {
    title: "돌베개 위의 밤",
    paragraphs: [
      "야곱은 광야에서 밤을 맞습니다. 머리맡에는 부드러운 베개가 아니라 돌이 있었습니다. 집에서 멀어지고, 형에게서 멀어지고, 익숙한 사랑의 자리에서도 멀어진 밤이었습니다. 그 밤은 벌처럼 보이지만, 동시에 야곱이 처음으로 혼자 서는 시간이었습니다.",
      "그는 꿈을 꿉니다. 땅에서 하늘까지 닿은 사다리가 있고, 하나님의 사자들이 오르내립니다. 두려움 속에서 잠든 사람에게 하늘이 열린 것입니다. 이 장면은 야곱에게 이렇게 말하는 듯합니다. 너의 길은 아직 끊어지지 않았다.",
      "하나님은 야곱에게 함께하겠다고 말씀하십니다. 그 말은 야곱이 한 일이 모두 괜찮다는 뜻이 아닙니다. 오히려 그의 복잡한 마음, 그의 잘못, 그의 불안 속에서도 아직 관계가 끝나지 않았다는 뜻에 가깝습니다.",
      "사람에게 가장 깊은 위로는 완벽하다는 칭찬이 아닐 때가 많습니다. 불완전한데도 버려지지 않는다는 감각입니다. 실수했는데도 다시 배울 수 있다는 감각입니다. 야곱의 밤에는 바로 그 조용한 위로가 내려옵니다.",
      "잠들기 전 우리에게도 필요한 말은 이것일지 모릅니다. 오늘의 불안이 당신의 전부는 아닙니다. 오늘의 실수가 당신의 이름을 끝까지 결정하지 않습니다. 돌베개 같은 밤에도 하늘은 아주 조용히 열릴 수 있습니다.",
    ],
  },
  {
    title: "인정 욕구의 뿌리",
    paragraphs: [
      "야곱의 인정 욕구는 단순히 욕심이 많아서 생긴 마음으로만 보기 어렵습니다. 그 안에는 비교 속에서 자란 불안, 사랑을 확인하고 싶은 마음, 먼저 선택받고 싶은 갈망이 엉켜 있었습니다. 사람의 마음은 대개 한 가지 이유로만 움직이지 않습니다.",
      "비교가 오래되면 마음은 타인의 축복을 자신의 결핍처럼 느낍니다. 누군가가 칭찬받으면 내가 줄어든 것 같고, 누군가가 앞서가면 내가 늦어진 것 같습니다. 그러나 타인의 빛이 내 빛을 꺼뜨리는 것은 아닙니다.",
      "성경은 야곱을 미화하지 않습니다. 그는 속였고, 도망쳤고, 오랫동안 불안 속에서 살았습니다. 하지만 동시에 성경은 그를 버려진 사람으로만 두지 않습니다. 복잡한 사람도 길 위에서 다듬어질 수 있다고 보여 줍니다.",
      "심리학적으로도 중요한 것은 불안을 없애는 일이 아니라 불안과 맺는 관계를 바꾸는 일입니다. 불안이 올라올 때 즉시 무언가를 빼앗거나 증명하려 하지 않고, 먼저 그 마음의 뿌리를 바라보는 것입니다.",
      "나는 지금 인정받고 싶은 걸까. 나는 밀려날까 봐 두려운 걸까. 나는 사랑을 잃었다고 느끼는 걸까. 이런 질문은 마음을 꾸짖는 말이 아닙니다. 불안이 잡아끄는 손을 천천히 풀어 주는 말입니다.",
    ],
  },
  {
    title: "불안한 마음을 위한 축복",
    paragraphs: [
      "야곱은 한순간에 달라지지 않았습니다. 그의 이야기는 계속 이어지고, 그는 또 속기도 하고, 다시 두려워하기도 합니다. 그러나 그 긴 길 속에서 야곱은 조금씩 배웁니다. 축복은 훔쳐서만 얻는 것이 아니라, 길 위에서 새롭게 받는 것이기도 하다는 사실을 배웁니다.",
      "우리도 하루 만에 인정 욕구에서 자유로워지지는 않습니다. 비교가 사라지고 불안이 조용해지는 데에는 시간이 필요합니다. 하지만 오늘 밤에는 적어도 한 가지를 내려놓아도 좋습니다. 더 사랑받기 위해 애쓰던 긴장을 조금 내려놓는 일입니다.",
      "당신은 누군가보다 앞서야만 가치 있는 사람이 아닙니다. 더 강하게 보이고, 더 완벽하게 말하고, 더 많이 증명해야만 사랑받을 수 있는 것도 아닙니다. 당신의 마음이 불안했다는 사실은 당신이 나쁘다는 증거가 아니라, 오래 안심하고 싶었다는 신호일 수 있습니다.",
      "야곱의 이야기는 우리를 조용한 자리로 초대합니다. 나의 비교를 알아차리고, 나의 속임수를 미워하기 전에 그 뒤의 두려움을 바라보는 자리입니다. 그리고 그 두려움 위에 정죄보다 깊은 위로가 내려올 수 있음을 믿어 보는 자리입니다.",
      "이제 이 이야기를 천천히 접어 두겠습니다. 야곱의 밤처럼, 당신의 밤도 아직 끝난 이야기가 아닙니다. 사랑받고도 불안했던 마음이 조금씩 숨을 고르고, 내일은 조금 덜 움켜쥐고, 조금 더 편안히 걸어가기를 바랍니다. 다음 영상에서는 야곱이 라헬을 사랑하면서도 왜 또 다른 기다림을 배워야 했는지 조용히 이어 가겠습니다.",
    ],
  },
];

const gentleReflections = [
  "이 장면을 떠올릴 때, 우리는 야곱을 멀리 있는 인물로만 보지 않아도 됩니다. 사랑을 확인하고 싶어 했던 마음은 오늘 밤 우리 안에도 아주 작게 남아 있을 수 있습니다.",
  "붙잡는 손은 욕심의 손일 수도 있지만, 때로는 놓치면 버려질 것 같은 두려움의 손이기도 합니다. 그래서 이 이야기는 처음부터 마음을 천천히 읽어 달라고 부탁합니다.",
  "사랑을 받았다는 사실이 마음의 깊은 안정으로 내려오기까지는 시간이 필요합니다. 누군가의 선택을 머리로 알아도 몸과 마음은 늦게 따라올 때가 있습니다.",
  "비교가 반복되는 집에서는 아이들이 말하지 않아도 순위를 느낍니다. 그 순위의 감각은 어른이 된 뒤에도 아주 작은 말투 하나에 다시 깨어날 수 있습니다.",
  "우리는 오늘 이 집을 비난하기보다, 그 안에서 불안을 배운 사람의 숨을 들어 보려 합니다. 판단을 조금 늦추면 오래된 이야기는 더 부드럽게 마음에 들어옵니다.",
  "인정받고 싶은 마음은 사라져야 할 약점이 아니라 돌봄받아야 할 신호입니다. 그 신호를 너무 오래 무시하면 마음은 더 큰 소리로 자신을 증명하려 합니다.",
  "받은 사랑과 받지 못한 사랑은 마음 안에서 서로 다투기도 합니다. 그래서 사람은 감사하면서도 서운하고, 사랑받으면서도 외로울 수 있습니다.",
  "조건부 인정의 불안은 늘 다음 증거를 찾습니다. 그러나 증거가 많아질수록 마음이 편해지는 것이 아니라, 잃을 것이 많아진 것처럼 더 긴장할 때가 있습니다.",
  "그 계산기를 끄는 일은 쉽지 않습니다. 하지만 적어도 지금 이 밤에는 계산을 잠시 멈추고, 마음이 왜 그렇게 세고 있었는지 조용히 물어볼 수 있습니다.",
  "누군가가 먼저 선택되었다고 해서 내 존재가 작아지는 것은 아닙니다. 하지만 마음은 그 사실을 천천히 배웁니다. 이 밤의 이야기는 그 배움의 속도를 재촉하지 않습니다.",
  "급한 장면일수록 마음은 자기 상처를 더 선명하게 드러냅니다. 야곱이 본 것은 형의 배고픔만이 아니라, 오래 기다려 온 자기 자리였을지도 모릅니다.",
  "불안한 영리함은 잠깐 길을 열어 주지만 오래 쉴 자리를 주지는 못합니다. 그래서 마음은 이긴 뒤에도 자꾸 뒤를 돌아보게 됩니다.",
  "기다림이 어려운 이유는 시간이 느려서만은 아닙니다. 기다리는 동안 내가 잊히는 것은 아닐까 하는 두려움이 마음을 흔들기 때문입니다.",
  "두 사람의 허기를 함께 보면 이야기는 조금 더 인간적으로 다가옵니다. 한 사람은 몸이 고팠고, 한 사람은 인정이 고팠습니다.",
  "질문은 마음을 정죄하지 않고 멈추게 합니다. 멈춘 마음은 처음으로 자기 행동이 아니라 자기 두려움을 바라볼 수 있습니다.",
  "가족 안의 말은 가볍게 지나가는 듯해도 오래 남습니다. 누가 들었는지, 누가 선택되었는지, 누가 빠졌는지가 마음의 지도를 바꿉니다.",
  "망설임은 아직 마음이 완전히 굳지 않았다는 신호일 수 있습니다. 사람은 잘못된 길 앞에서도 아주 짧은 순간, 돌아설 수 있는 빛을 봅니다.",
  "다른 사람의 옷을 입는다는 것은 다른 사람의 자리로 들어가려는 마음을 보여 줍니다. 그러나 마음 깊은 곳의 불안은 옷을 바꾼다고 조용해지지 않습니다.",
  "거짓말은 축복의 문을 연 것처럼 보였지만, 동시에 야곱 안에 더 깊은 떨림을 남겼습니다. 얻은 말과 잃은 평안이 한순간에 함께 온 것입니다.",
  "가면은 처음에는 보호처럼 느껴집니다. 하지만 오래 쓰고 있으면 누가 나를 사랑하는지, 내가 만든 모습을 사랑하는지 구분하기 어려워집니다.",
  "도망길은 바깥으로는 이동이지만 안쪽으로는 불안의 결과입니다. 마음이 속임수로 얻은 것을 감당하지 못할 때, 사람은 몸보다 먼저 마음으로 도망칩니다.",
  "인정은 잠시 따뜻하지만 중심이 되면 무거워집니다. 누군가의 말 한마디에 하루가 올라가고 내려간다면, 마음은 쉬는 법을 잊어버립니다.",
  "축복이 있었는데도 밤이 길었다는 사실은 중요합니다. 겉으로 얻은 것이 많아도 안쪽에서 화해하지 못한 마음은 여전히 길 위에 서 있을 수 있습니다.",
  "인정을 얻은 뒤의 불안은 더 조용해서 잘 들키지 않습니다. 겉으로는 괜찮아 보여도 속으로는 계속 잃을까 봐 대비하고 있을 수 있습니다.",
  "확인을 요구하는 마음을 안아 준다는 것은 그 마음의 말을 끝까지 들어 주는 일입니다. 왜 그렇게 두려웠는지 알게 되면 움켜쥔 손이 조금 느슨해집니다.",
  "광야의 밤은 아무도 나를 대신 설명해 주지 않는 시간입니다. 그래서 외롭지만, 그만큼 처음으로 자기 마음을 직접 만나는 시간이 되기도 합니다.",
  "하늘이 열린 꿈은 야곱이 완벽해서 주어진 장면이 아닙니다. 오히려 불안하고 도망치는 사람에게도 길이 닫히지 않았다는 장면입니다.",
  "함께하겠다는 말은 사람의 마음에 깊은 숨을 줍니다. 내가 나를 완전히 이해하지 못해도, 길이 완전히 끊긴 것은 아니라는 감각을 줍니다.",
  "버려지지 않는다는 감각은 인정 욕구보다 깊은 곳을 만집니다. 사람은 그 감각을 조금씩 배울 때, 더 이상 모든 사랑을 증명하려 하지 않아도 됩니다.",
  "돌베개 같은 밤은 편하지 않지만 솔직합니다. 아무것도 꾸밀 수 없는 자리에서 마음은 오히려 가장 진짜인 위로를 만날 수 있습니다.",
  "사람의 마음은 복합적이어서 욕심과 두려움, 사랑과 결핍이 한곳에 섞여 있습니다. 그래서 성경 속 인물도 우리처럼 단순한 한 문장으로 설명되지 않습니다.",
  "타인의 빛이 내 빛을 꺼뜨리지 않는다는 말은 천천히 익혀야 할 진실입니다. 비교에 익숙한 마음은 그 말을 여러 번 들어야 비로소 조금 믿습니다.",
  "야곱이 버려지지 않았다는 사실은 우리에게도 조용한 숨을 줍니다. 복잡하고 모순된 마음을 가졌다고 해서 사람이 끝난 것은 아닙니다.",
  "불안을 없애려 애쓰기보다 불안이 말하려는 것을 듣는 순간, 마음은 전쟁터에서 대화의 자리로 옮겨 갑니다. 그 변화만으로도 밤은 조금 부드러워집니다.",
  "이 질문들은 답을 빨리 찾기 위한 것이 아닙니다. 마음이 자기 자신을 적으로 대하지 않도록 돕는 작은 문장들입니다.",
  "긴 길은 때로 우리를 답답하게 하지만, 천천히 달라지는 사람에게는 긴 시간이 필요합니다. 야곱의 이야기가 긴 이유도 그 때문입니다.",
  "오늘 밤 내려놓는 것은 포기가 아니라 휴식입니다. 사랑받기 위해 계속 긴장하던 몸에게 이제 조금 쉬어도 된다고 말해 주는 일입니다.",
  "불안은 나쁨의 증거가 아니라 안심하고 싶은 마음의 신호일 수 있습니다. 그렇게 바라보면 우리는 자신을 조금 덜 몰아세울 수 있습니다.",
  "두려움 위에 위로가 내려온다는 말은 잘못을 덮자는 뜻이 아닙니다. 자기 마음을 정직하게 보고, 다시 다른 선택을 배울 수 있다는 뜻입니다.",
  "다음 이야기를 향한 작은 문을 남겨 두고, 오늘의 이야기는 여기서 조용히 멈춥니다. 밤은 모든 결론을 요구하지 않고, 마음이 천천히 쉬도록 기다려 줍니다.",
];

const sleepPacingNotes = [
  "그러니 이 첫 장면에서는 사건보다 분위기를 먼저 느껴도 좋습니다. 장막 안의 어둠, 서로 다른 두 아이의 숨, 그리고 말없이 쌓이는 기대를 천천히 바라봅니다.",
  "발꿈치를 붙잡은 손은 태어나는 순간의 작은 몸짓이지만, 이야기 안에서는 평생의 질문처럼 남습니다. 나는 어디에 서야 하는가, 나는 누구에게 보이는가 하는 질문입니다.",
  "사랑이 있어도 마음이 불안할 수 있다는 사실을 인정하면, 우리는 자신을 덜 이상하게 여기게 됩니다. 받은 것이 있는데도 허전한 마음을 조금 더 정직하게 볼 수 있습니다.",
  "가족 안의 비교는 대개 큰 선언으로 오지 않습니다. 식탁의 시선, 짧은 칭찬, 누가 더 잘 어울리는지에 대한 작은 말들이 마음에 천천히 새겨집니다.",
  "그 공기를 조용히 상상하다 보면, 야곱의 선택이 갑자기 생긴 일이 아니라 오랜 분위기 속에서 만들어졌다는 것을 느끼게 됩니다.",
  "이 마음은 우리를 사랑 밖으로 밀어내기보다, 사랑을 더 깊이 배우라는 신호일 때가 있습니다. 단지 그 배움은 서두른다고 빨라지지 않습니다.",
  "받지 못한 하나는 때때로 받은 열 가지보다 크게 느껴집니다. 그래서 사람은 풍성한 자리에서도 이상하게 빈자리를 먼저 바라볼 수 있습니다.",
  "증거를 모으는 마음은 잠깐 안심하지만 오래 쉬지 못합니다. 다음 증거가 필요해지고, 다음 확인이 필요해지며, 결국 마음은 계속 깨어 있게 됩니다.",
  "그 계산은 누구에게도 크게 말하지 못합니다. 그러나 밤이 깊어질수록 마음 안에서는 아주 선명한 숫자처럼 떠오를 수 있습니다.",
  "내 자리가 사라질까 두려운 마음은 인간적입니다. 그러니 오늘은 그 두려움을 없애려 하기보다, 그 두려움이 얼마나 오래 혼자 있었는지 살펴봅니다.",
  "팥죽 냄새가 피어오르는 장면은 단순한 식욕의 장면이 아닙니다. 배고픔과 기회, 결핍과 계산이 한자리에서 만나는 조용한 심리의 장면입니다.",
  "영리함이 불안과 만나면 사람은 관계보다 확보를 먼저 생각합니다. 그 순간에는 얻는 것처럼 보이지만, 마음의 평안은 더 멀어질 수 있습니다.",
  "기다림은 마음에게 신뢰를 요구합니다. 하지만 오래 불안했던 마음은 기다림을 신뢰가 아니라 방치처럼 느낄 때가 있습니다.",
  "서로 다른 허기를 보면 우리는 어느 한쪽만 쉽게 비난하지 않게 됩니다. 사람은 자기 안에서 가장 급한 결핍을 따라 움직일 때가 많기 때문입니다.",
  "작은 질문 하나가 큰 행동을 멈출 때가 있습니다. 지금 내가 잡으려는 것이 사랑인지, 자리를 잃지 않으려는 방어인지 묻는 일입니다.",
  "늙은 이삭의 장막은 어둡고 조용했지만, 그 안에는 가족 전체의 오래된 긴장이 모여 있었습니다. 보이지 않는 마음들이 한 장면 안으로 들어온 것입니다.",
  "돌아설 수 있는 빛은 언제나 크지 않습니다. 아주 짧은 망설임, 아주 작은 불편함, 마음 한쪽의 조용한 떨림으로 찾아올 때가 많습니다.",
  "자기 얼굴을 숨긴다는 것은 슬픈 일입니다. 진짜 나로는 충분하지 않을 것 같다는 믿음이 사람을 다른 사람의 모습 안으로 밀어 넣습니다.",
  "거짓말의 순간은 짧지만, 그 말이 마음에 남기는 울림은 깁니다. 축복의 소리는 들렸지만, 안쪽에서는 들킬까 두려운 숨이 함께 흐릅니다.",
  "박수를 받았는데도 편하지 않다면, 마음은 아마 나 자신이 아니라 내가 꾸민 모습을 칭찬받았다고 느끼는지도 모릅니다.",
  "얻자마자 떠나야 하는 장면은 야곱 이야기의 깊은 역설입니다. 손에 쥔 것은 있었지만, 머무를 자리는 사라졌습니다.",
  "불안은 늘 마지막 하나를 약속합니다. 하지만 마지막 하나를 얻고 나면, 마음은 또 다른 마지막 하나를 만들어 냅니다.",
  "그래서 축복은 말로만 받는 것이 아니라 마음이 감당할 수 있는 자리에서 다시 배워야 합니다. 야곱에게는 그 배움이 도망길에서 시작됩니다.",
  "인정에 묶인 마음은 타인의 표정에 민감해집니다. 웃음 하나, 침묵 하나, 답장이 늦은 시간 하나에도 자기 가치를 읽으려 합니다.",
  "확인을 멈춘다는 것은 사랑을 포기한다는 뜻이 아닙니다. 오히려 사랑을 증명 게임에서 꺼내어 조금 더 깊은 자리로 옮기는 일입니다.",
  "광야는 사람에게 불필요한 소리를 줄입니다. 남의 기대도, 가족의 비교도, 익숙한 역할도 잠시 멀어지고 마음의 민낯만 남습니다.",
  "하늘과 땅을 잇는 사다리는 야곱의 불안보다 더 큰 연결을 보여 줍니다. 사람의 실수보다 깊은 길이 아직 열려 있다는 상징입니다.",
  "함께한다는 말은 당장 모든 문제를 풀어 주지는 않습니다. 그러나 그 말은 혼자라는 감각을 조금씩 누그러뜨리고, 다시 걸을 힘을 줍니다.",
  "완벽하지 않아도 버려지지 않는다는 감각은 오래된 불안을 녹이는 느린 온기와 같습니다. 그 온기는 천천히 내려와도 충분합니다.",
  "돌베개는 차갑지만 그 위에서 야곱은 처음으로 다른 종류의 위로를 만납니다. 사람의 손이 아니라, 길 자체가 아직 이어져 있다는 위로입니다.",
  "욕심이라고만 부르면 이야기는 빨리 끝납니다. 그러나 욕심 뒤의 두려움까지 보면, 우리는 더 깊은 회복의 길을 볼 수 있습니다.",
  "비교의 마음은 타인의 삶을 위협으로 바꾸지만, 위로받은 마음은 타인의 삶을 다시 이야기로 바라볼 수 있습니다.",
  "성경의 인물들이 복잡하게 그려지는 이유는 우리를 숨 쉬게 하기 위해서인지도 모릅니다. 복잡한 마음도 이야기 안에 들어올 수 있기 때문입니다.",
  "불안을 대화의 자리로 옮기는 일은 아주 실제적입니다. 먼저 이름을 붙이고, 다음에 숨을 고르고, 그 뒤에 행동을 늦추는 것입니다.",
  "질문을 품고 잠드는 밤은 실패한 밤이 아닙니다. 답을 강제로 만들지 않고, 마음이 천천히 풀리도록 맡기는 밤입니다.",
  "길게 이어지는 변화는 조용해서 잘 티가 나지 않습니다. 하지만 어느 날 같은 불안 앞에서 조금 덜 급해진 자신을 발견하게 됩니다.",
  "휴식은 마음에게 새로운 선택지를 줍니다. 지친 상태에서는 붙잡는 것밖에 보이지 않지만, 쉰 마음은 놓아도 사라지지 않는 것을 배웁니다.",
  "안심하고 싶었다는 신호를 알아차리면 자기비난은 조금 약해집니다. 그 자리에서 우리는 더 나은 선택을 시작할 수 있습니다.",
  "위로는 책임을 피하게 만드는 말이 아니라, 책임을 질 수 있을 만큼 마음을 세워 주는 말입니다. 야곱의 길도 그렇게 다시 이어집니다.",
  "이 마지막 장면에서는 야곱을 완성된 사람으로 남기지 않습니다. 아직 배우는 사람, 아직 불안하지만 길 위에 있는 사람으로 조용히 남겨 둡니다.",
];

const closingBreaths = [
  "이제 이 문장을 따라 마음의 속도를 조금 낮춰 봅니다.",
  "그 손의 떨림을 비난하지 않고 잠시 바라봅니다.",
  "안심은 이해보다 늦게 찾아와도 괜찮습니다.",
  "작은 비교의 기억도 오늘 밤에는 쉬어 갈 수 있습니다.",
  "이 집의 어둠 속에서 우리 마음도 천천히 숨을 쉽니다.",
  "인정받고 싶은 마음을 부드럽게 불러도 괜찮습니다.",
  "받지 못한 자리의 아픔도 조용히 이름을 얻습니다.",
  "증거를 찾던 마음에게 잠시 멈출 시간을 줍니다.",
  "세어 보던 마음이 이제는 조금 내려앉아도 됩니다.",
  "사라질까 두려웠던 자리를 밤의 고요에 맡겨 봅니다.",
  "식탁 위의 장면은 천천히 우리 안의 허기를 비춥니다.",
  "붙잡으려던 마음도 사실은 쉬고 싶었을지 모릅니다.",
  "기다림이 두려웠던 마음에게 작은 등불을 켭니다.",
  "서로 다른 허기를 알아차리면 분노가 조금 누그러집니다.",
  "질문은 마음을 몰아세우지 않고 부드럽게 멈춥니다.",
  "장막 안의 속삭임을 멀리서 조용히 바라봅니다.",
  "망설임의 짧은 빛도 마음에게는 소중한 신호입니다.",
  "다른 옷을 입은 마음의 외로움을 천천히 느껴 봅니다.",
  "축복의 말과 불안한 숨이 함께 있었음을 기억합니다.",
  "가면을 벗지 못했던 마음도 오늘 밤에는 이해받을 수 있습니다.",
  "떠나는 발걸음마다 얻은 것과 잃은 것이 함께 따라옵니다.",
  "마지막 하나를 찾던 마음이 잠시 손을 풀어 봅니다.",
  "길 위의 축복은 늦게 오지만 더 깊이 남을 수 있습니다.",
  "타인의 표정에 묶였던 마음을 밤의 침묵 안에 내려놓습니다.",
  "확인을 멈춘 자리에서 사랑은 조금 더 넓어집니다.",
  "광야의 고요는 마음의 소리를 더 또렷하게 들려줍니다.",
  "열린 하늘을 상상하며 긴장한 몸을 천천히 풀어 봅니다.",
  "함께한다는 말이 오늘의 숨에 조용히 닿습니다.",
  "버려지지 않는다는 감각을 아주 작게 받아들입니다.",
  "차가운 돌 위에도 잠시 머물 수 있는 은혜가 있습니다.",
  "두려움 뒤의 마음을 보면 이야기는 더 따뜻해집니다.",
  "타인의 빛을 두려워하지 않는 밤이 조금씩 다가옵니다.",
  "복잡한 마음도 이야기 안에서 자리를 얻습니다.",
  "불안을 적으로 삼지 않고 대화의 자리로 초대합니다.",
  "답이 없는 밤에도 마음은 천천히 정리될 수 있습니다.",
  "조용한 변화는 내일의 작은 반응에서 드러날 것입니다.",
  "쉬는 마음은 붙잡지 않아도 남는 사랑을 배웁니다.",
  "자기비난이 약해지는 자리에서 새로운 선택이 시작됩니다.",
  "위로받은 마음은 책임을 더 부드럽게 감당합니다.",
  "아직 끝나지 않은 길 위에 오늘의 평안을 남겨 둡니다.",
];

const baseParagraphs = chapters.flatMap((chapter) => chapter.paragraphs);
const spokenParagraphs = baseParagraphs.map((paragraph, index) => `${paragraph} ${gentleReflections[index]} ${sleepPacingNotes[index]}`);
const script = spokenParagraphs.join("\n\n");
const structuredScript = chapters
  .map((chapter, index) => `챕터 ${index + 1}. ${chapter.title}\n\n${chapter.paragraphs
    .map((paragraph, paragraphIndex) => {
      const globalIndex = index * 5 + paragraphIndex;
      return `${paragraph} ${gentleReflections[globalIndex]} ${sleepPacingNotes[globalIndex]}`;
    })
    .join("\n\n")}`)
  .join("\n\n");

const wholeQuality = assertLongformScriptQuality(script, {
  minParagraphs: 40,
  maxRepeatedStart: 3,
  maxRepeatedSentence: 2,
  maxWatchedPhraseCount: 12,
});
if (!wholeQuality.ok) {
  console.error(JSON.stringify(wholeQuality, null, 2));
  throw new Error("Jacob sample script quality gate failed");
}

const segmentScripts = splitEvenlyByParagraphs(spokenParagraphs, segmentPlan.segments.length);
const segmentRecords = [];

for (const [index, segment] of segmentPlan.segments.entries()) {
  const segmentDir = join(exportDir, "segments", segment.id);
  mkdirSync(segmentDir, { recursive: true });
  const segmentScript = segmentScripts[index].join("\n\n");
  const timeline = buildVisualTimelineForWindow({
    startSeconds: segment.startSeconds,
    durationSeconds: segment.durationSeconds,
    introSeconds: segmentPlan.introSeconds,
    introSceneSeconds: segmentPlan.introSceneSeconds,
    bodySceneSeconds: segmentPlan.bodySceneSeconds,
  });
  const sceneTexts = splitTextIntoScenes(segmentScript, timeline.length);
  const contextCards = sceneTexts.map((text, sceneIndex) => buildSceneContextCard({
    narration: text,
    order: sceneIndex + 1,
    topic: `${title} ${slug}`,
  }));
  writeFileSync(join(segmentDir, "visual-context-cards.json"), JSON.stringify({
    version: 1,
    source: "scene-context-card",
    segmentId: segment.id,
    scenes: contextCards,
  }, null, 2), "utf8");
  const storyboard = buildStoryboard(sceneTexts, timeline, index, contextCards);
  const qualityReport = assertLongformScriptQuality(segmentScript, {
    minParagraphs: Math.max(18, Math.round(segment.durationSeconds / 35)),
    maxRepeatedStart: 3,
    maxRepeatedSentence: 2,
    maxWatchedPhraseCount: 10,
  });
  if (!qualityReport.ok) {
    console.error(JSON.stringify(qualityReport, null, 2));
    throw new Error(`${segment.id} script quality gate failed`);
  }
  writeFileSync(join(segmentDir, "script.txt"), `${segmentScript}\n`, "utf8");
  writeFileSync(join(segmentDir, "script-quality-report.json"), JSON.stringify(qualityReport, null, 2), "utf8");
  writeFileSync(join(segmentDir, "script-budget-report.json"), JSON.stringify({
    segmentId: segment.id,
    targetSeconds: segment.durationSeconds,
    actualChars: segmentScript.replace(/\s/g, "").length,
    targetCharsPerSecond: 5.2,
    ratio: Number((segmentScript.replace(/\s/g, "").length / Math.max(1, segment.durationSeconds * 5.2)).toFixed(3)),
  }, null, 2), "utf8");
  writeFileSync(join(segmentDir, "visual-timeline.json"), JSON.stringify({
    segmentId: segment.id,
    targetSeconds: segment.durationSeconds,
    scenes: timeline,
  }, null, 2), "utf8");
  writeFileSync(join(segmentDir, "hermes-manual-storyboard.md"), `${storyboard}\n`, "utf8");
  writeFileSync(join(segmentDir, "production.json"), JSON.stringify({
    parentSlug: slug,
    sourceSlug: slug,
    segment,
    project: {
      channel: "gguljam-bible",
      slug: `${slug}-${segment.id}`,
      title: `${title} (${segment.id})`,
      target_minutes: Math.round((segment.durationSeconds / 60) * 100) / 100,
    },
    render: {
      engine: "hermes-studio",
      manual_storyboard: "hermes-manual-storyboard.md",
      target_seconds: segment.durationSeconds,
      visual_mode: "contextual-keyframes",
      orientation: "landscape",
    },
    visualStyle: "strict pure black and white grayscale biblical oil painting, no color tint, no purple, no blue",
  }, null, 2), "utf8");
  segmentRecords.push({
    ...segment,
    dir: segmentDir,
    scriptPath: join(segmentDir, "script.txt"),
    storyboardPath: join(segmentDir, "hermes-manual-storyboard.md"),
    finalPath: join(segmentDir, "manual-assembly", "final.mp4"),
  });
}

writeFileSync(join(exportDir, "script.txt"), `${script}\n`, "utf8");
writeFileSync(join(exportDir, "script-structured-for-review.txt"), `${structuredScript}\n`, "utf8");
writeFileSync(join(exportDir, "chapters.json"), JSON.stringify(chapters.map((chapter, index) => ({
  index: index + 1,
  title: chapter.title,
  paragraphCount: chapter.paragraphs.length,
})), null, 2), "utf8");
writeFileSync(join(exportDir, "production.json"), JSON.stringify({
  slug,
  title,
  targetSeconds,
  segmentMinutes: segmentPlan.segmentMinutes,
  segmentCount: segmentPlan.segments.length,
  totalSceneCount: segmentPlan.totalSceneCount,
  scriptQuality: wholeQuality,
  render: {
    engine: "hermes-studio",
    target_seconds: targetSeconds,
    visual_mode: "segmented-contextual-keyframes",
    orientation: "landscape",
  },
}, null, 2), "utf8");
writeFileSync(join(exportDir, "segment-manifest.json"), JSON.stringify({
  sourceSlug: slug,
  slug,
  title,
  targetSeconds,
  segmentPlan,
  segments: segmentRecords,
}, null, 2), "utf8");

console.log(JSON.stringify({
  exportDir,
  title,
  targetSeconds,
  noSpaceChars: script.replace(/\s/g, "").length,
  paragraphCount: spokenParagraphs.length,
  segmentCount: segmentRecords.length,
  totalSceneCount: segmentPlan.totalSceneCount,
}, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--slug") parsed.slug = argv[++i];
    else if (arg === "--target-seconds") parsed.targetSeconds = argv[++i];
    else if (arg === "--segment-minutes") parsed.segmentMinutes = argv[++i];
  }
  return parsed;
}

function splitEvenlyByParagraphs(paragraphs, count) {
  const groups = [];
  const perGroup = Math.ceil(paragraphs.length / count);
  for (let index = 0; index < count; index += 1) {
    groups.push(paragraphs.slice(index * perGroup, (index + 1) * perGroup));
  }
  return groups;
}

function splitTextIntoScenes(text, sceneCount) {
  const sentences = String(text)
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+|(?<=요\.)\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const scenes = Array.from({ length: sceneCount }, () => []);
  for (const [index, sentence] of sentences.entries()) {
    const bucket = Math.min(sceneCount - 1, Math.floor((index / Math.max(1, sentences.length)) * sceneCount));
    scenes[bucket].push(sentence);
  }
  return scenes.map((scene, index) => {
    if (scene.length) return scene.join(" ");
    return sentences[Math.min(sentences.length - 1, index)] || text.slice(0, 160);
  });
}

function buildStoryboard(sceneTexts, timeline, segmentIndex, contextCards = []) {
  const motifs = [
    "ancient family tent at night with two quiet sleeping mats",
    "young Jacob sitting near a small oil lamp, hands folded anxiously",
    "Esau as a distant strong silhouette at the tent entrance",
    "mother and son whispering beside a woven curtain, faces half hidden",
    "rough hands holding a simple bowl of stew on a dark table",
    "blind elderly Isaac reaching into uncertain shadow",
    "a son wearing another man's rough garment before an old father",
    "lonely desert road under stars, a traveler carrying a small bundle",
    "stone pillow in the wilderness beneath a ladder of pale light",
    "two paths crossing across a silent desert plain",
    "open hands slowly releasing a hidden cloth into darkness",
    "quiet dawn over ancient hills after a sleepless night",
  ];
  const cameraMoves = [
    "slow zoom in",
    "slow zoom out",
    "gentle pan left",
    "gentle pan right",
    "slow upward drift",
    "slow downward drift",
    "diagonal drift from lower left to upper right",
    "diagonal drift from upper right to lower left",
  ];
  const style = [
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
  const cameraAngles = [
    "wide establishing shot",
    "slow centered composition",
    "low close-up",
    "high wide angle",
    "medium rear shot",
    "symbolic still-life close shot",
  ];
  const lighting = [
    "soft moonlit grayscale haze",
    "hard side light in monochrome",
    "pale dawn light",
    "small oil-lamp glow rendered only in grayscale",
    "thin overhead light",
    "deep chiaroscuro with silver highlights",
  ];
  const moods = [
    "quiet and contemplative",
    "tender but uneasy",
    "solemn and compassionate",
    "restful and reflective",
    "lonely and consoling",
    "psychological but calm",
  ];
  const lines = [];
  for (const [index, scene] of timeline.entries()) {
    const text = sceneTexts[index] || "";
    const move = cameraMoves[(index + segmentIndex * 3) % cameraMoves.length];
    const card = contextCards[index] || buildSceneContextCard({ narration: text, order: index + 1, topic: `${title} ${slug}` });
    const prompt = compileContextPrompt({
      card,
      style: [
        style,
        "strict pure black and white only",
        "wide 16:9 composition",
        "restful negative space",
        "subtle human emotion",
        "no violence",
        "no gore",
      ].join(", "),
    });
    const alignment = scorePromptContextAlignment({ card, prompt });
    if (!alignment.ok) {
      throw new Error(`Storyboard context alignment failed for scene ${index + 1}: ${alignment.failures.join(", ")}`);
    }
    lines.push(`[${text}]`);
    lines.push(`${prompt} / ${cameraAngles[index % cameraAngles.length]} / ${lighting[index % lighting.length]} / ${moods[index % moods.length]} / ${move}, subtle slow Ken Burns movement / duration:${Math.round(scene.durationSeconds)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
