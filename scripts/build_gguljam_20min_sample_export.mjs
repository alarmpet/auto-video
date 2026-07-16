#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";
import { buildSegmentPlan, buildVisualTimelineForWindow } from "./lib/segment-plan.mjs";
import { buildSceneContextCard, compileContextPrompt, scorePromptContextAlignment } from "./lib/scene-context-card.mjs";

const root = "C:/Users/petbl/auto-video";
const args = parseArgs(process.argv.slice(2));
const slug = args.slug || `gguljam-bible-cain-envy-20min-sample-${stamp()}`;
const exportDir = join(root, "exports", slug);
mkdirSync(exportDir, { recursive: true });

const title = "자면서 듣는 성경 이야기. 카인이 동생을 미워한 마음의 뿌리 | 질투와 비교의 심리";
const targetSeconds = Number(args.targetSeconds || 1200);
const segmentPlan = buildSegmentPlan({
  targetSeconds,
  segmentMinutes: Number(args.segmentMinutes || 10),
  introSeconds: 60,
  introSceneSeconds: 6,
  bodySceneSeconds: 30,
});

const paragraphs = [
  "오늘 밤에는 아주 오래된 형제의 이야기를 조용히 펼쳐 보겠습니다. 카인과 아벨의 이야기는 누가 더 옳았는지를 빨리 가르는 이야기가 아닙니다. 한 사람이 비교 앞에서 자기 마음을 잃어 가는 과정을 보여 주는 이야기입니다. 잠시 숨을 고르고, 내 안에도 있었던 작은 서운함을 함께 바라보겠습니다.",
  "성경은 카인이 악한 사람으로 태어났다고 말하지 않습니다. 그는 땅을 일구는 사람이었고, 자기 손으로 얻은 것을 하나님 앞에 가져온 사람이었습니다. 그런데 어느 순간 그의 마음은 제물보다 시선에 붙잡힙니다. 나도 드렸는데, 왜 내 마음은 가벼워지지 않았을까. 이 질문이 조용히 커집니다.",
  "비교는 대개 눈앞의 차이에서 시작됩니다. 하지만 마음속에서는 더 깊은 말로 바뀝니다. 나는 덜 사랑받는 사람인가. 나는 충분하지 않은 사람인가. 카인이 아벨을 본 것은 사실이지만, 더 오래 바라본 것은 자기 안의 부족감이었을지 모릅니다.",
  "아벨은 카인의 적으로 소개되지 않습니다. 그는 동생입니다. 가까운 사람이 잘될 때 마음이 복잡해지는 이유가 여기에 있습니다. 멀리 있는 사람의 성공보다 가까운 사람의 인정이 더 아프게 느껴질 때가 있습니다. 그 가까움이 내 자리를 빼앗긴 것처럼 느껴지기 때문입니다.",
  "하나님은 카인에게 바로 벌을 내리지 않습니다. 먼저 말을 거십니다. 네가 분하여 함은 어찌 됨이며, 안색이 변함은 어찌 됨이냐. 이 질문은 정죄라기보다 멈춤에 가깝습니다. 네 마음이 지금 어디로 가고 있는지 보라는 부드럽고도 단단한 부름입니다.",
  "감정은 문 앞에 엎드려 기다릴 때가 있습니다. 분노, 서운함, 질투, 수치심은 한순간에 주인이 되려 하지 않습니다. 처음에는 작은 신호로 옵니다. 얼굴이 굳고, 말수가 줄고, 상대의 기쁨을 축하하기 어려워집니다. 그때 마음은 이미 도움을 청하고 있습니다.",
  "현대 심리학에서는 비교가 자존감의 약한 부분을 건드릴 때 감정이 크게 흔들린다고 말합니다. 비교 자체가 문제라기보다, 비교가 나의 존재 가치와 붙어 버릴 때 고통이 커집니다. 카인의 마음도 어쩌면 이렇게 말하고 있었을지 모릅니다. 내 제물이 거절된 것이 아니라, 내가 거절된 것 같다.",
  "하지만 성경은 카인에게 다른 길이 있음을 보여 줍니다. 선을 행하면 어찌 낯을 들지 못하겠느냐는 말은, 아직 길이 닫히지 않았다는 뜻입니다. 마음이 어두워졌다고 해서 끝난 것은 아닙니다. 지금 알아차리면, 아직 돌아설 수 있습니다.",
  "우리도 밤마다 비슷한 문 앞에 설 때가 있습니다. 누군가의 성과, 가족의 말, 친구의 소식, 직장의 평가가 마음을 작게 만들 때가 있습니다. 그때 가장 먼저 할 일은 자기 마음을 나무라는 것이 아닙니다. 아, 내가 지금 비교 앞에서 아파하고 있구나 하고 알아차리는 것입니다.",
  "질투를 인정한다고 해서 나쁜 사람이 되는 것은 아닙니다. 오히려 인정하지 못한 질투가 더 거칠어집니다. 이름 붙인 감정은 조금 작아집니다. 질투라고 부르면 질투가 전부가 아니게 됩니다. 그 밑에 있는 인정받고 싶은 마음, 놓칠까 두려운 마음을 볼 수 있습니다.",
  "카인은 그 마음을 말로 풀지 못했습니다. 들로 나갔고, 침묵 속에서 비극이 벌어졌습니다. 마음이 말이 되지 못하면 행동이 대신 말할 때가 있습니다. 그래서 오늘 밤 우리는 행동까지 가기 전에 마음을 문장으로 만들어 보려 합니다. 나는 서운했다. 나는 비교했다. 나는 사랑받고 싶었다.",
  "하나님이 카인에게 던진 질문은 우리에게도 남아 있습니다. 네 아우 아벨이 어디 있느냐. 이 질문은 단지 위치를 묻는 말이 아닙니다. 네 관계는 어디에 있느냐. 네 마음은 지금 누구를 잃어버렸느냐. 네 안의 다정함은 어디쯤 멈추어 있느냐고 묻는 말처럼 들립니다.",
  "카인의 대답은 방어적입니다. 내가 내 아우를 지키는 자니이까. 상처받은 마음은 종종 책임을 멀리 밀어냅니다. 내가 왜 해야 합니까. 내가 더 아픕니다. 하지만 관계는 책임을 완전히 버리는 순간 더 깊이 무너집니다. 책임은 벌이 아니라 회복의 첫 문일 수 있습니다.",
  "이 이야기는 무섭지만, 동시에 우리를 조심스럽게 위로합니다. 성경은 마음의 어두운 움직임을 숨기지 않습니다. 믿음의 책 안에도 질투와 비교와 실패가 그대로 들어 있습니다. 그러니 우리의 복잡한 마음도 하나님 앞에서 숨길 필요가 없습니다.",
  "오늘 밤 당신 안에 비교의 마음이 있었다면, 그것을 조용히 내려놓아도 괜찮습니다. 그 마음은 당신의 전부가 아닙니다. 질투가 있었다고 해서 사랑이 사라진 것은 아닙니다. 서운함이 있었다고 해서 관계의 가능성이 끝난 것도 아닙니다.",
  "카인의 이야기는 우리에게 묻습니다. 네 얼굴이 굳어지기 전에, 네 말이 차가워지기 전에, 네 마음이 들판으로 혼자 걸어가기 전에 멈출 수 있겠느냐고 묻습니다. 그 멈춤은 아주 작을 수 있습니다. 숨 한 번, 고백 한 문장, 축복 한마디면 충분할 때도 있습니다.",
  "잠들기 전, 오늘 떠오르는 한 사람을 생각해 봅니다. 비교 때문에 마음이 멀어진 사람일 수도 있고, 괜히 미웠던 사람일 수도 있습니다. 그 사람을 억지로 좋아하려 하지 않아도 됩니다. 다만 마음속에서 이렇게 말해 봅니다. 나도 아팠고, 그 사람도 길 위에 있다.",
  "성경은 카인의 실패를 기록하지만, 우리의 밤은 아직 끝나지 않았습니다. 내일 아침에는 조금 덜 비교하고, 조금 더 천천히 반응하고, 조금 더 부드럽게 말할 기회가 올 수 있습니다. 오늘은 그 가능성만 품고 쉬어도 충분합니다.",
  "이제 이야기를 조용히 접겠습니다. 카인과 아벨의 이야기는 오래전 들판에만 머물지 않습니다. 그것은 우리 마음의 문 앞에도 서 있습니다. 그러나 문 앞에 엎드린 감정이 있어도, 우리는 그 감정을 다스리는 법을 배워 갈 수 있습니다. 오늘 밤 당신의 마음이 조금 가벼워지기를 바랍니다.",
  "눈을 감아도 좋습니다. 비교가 남긴 긴장을 천천히 내려놓습니다. 나는 누군가보다 커져야만 사랑받는 사람이 아닙니다. 나는 인정이 부족한 날에도 존재하는 사람입니다. 하나님 앞에서, 그리고 조용한 밤의 품 안에서, 오늘의 마음을 잠시 쉬게 해도 됩니다.",
];

const reflections = [
  "이 이야기를 들을 때 우리는 사건의 결말보다 마음이 기울기 시작한 첫 지점을 더 오래 바라보려 합니다. 사람의 마음은 어느 날 갑자기 무너지는 것처럼 보여도, 사실은 아주 작은 비교와 아주 작은 서운함이 반복되며 방향을 잃을 때가 많습니다. 오늘 밤에는 그 작은 방향의 변화를 천천히 살피겠습니다.",
  "땅을 일구는 손은 매일 같은 흙을 만집니다. 씨앗을 묻고, 기다리고, 다시 허리를 숙입니다. 카인의 삶에도 그런 성실함이 있었을 것입니다. 그래서 그의 마음이 흔들린 이유를 단순한 악의로만 설명하면 너무 빨리 지나가게 됩니다. 성실한 사람도 인정 앞에서는 아플 수 있습니다.",
  "부족감은 실제보다 크게 들리는 목소리를 가지고 있습니다. 누군가 나보다 더 사랑받는 것 같을 때, 마음은 사실을 확인하기보다 상상을 덧붙입니다. 저 사람은 선택받았고 나는 밀려났다. 이런 해석은 조용하지만 깊게 파고듭니다. 카인의 얼굴이 어두워진 자리에는 그런 해석이 있었을지도 모릅니다.",
  "가까운 사람과의 비교는 더 복잡합니다. 우리는 가까운 사람을 사랑하면서도, 그 사람이 받은 인정 앞에서 자신이 작아지는 느낌을 받을 수 있습니다. 이 모순을 인정하는 것이 중요합니다. 사랑과 질투가 같은 마음 안에 잠시 함께 있을 수 있다는 것을 인정하면, 우리는 그 마음을 조금 덜 두려워하게 됩니다.",
  "하나님의 질문은 카인을 몰아붙이는 질문이 아니라 마음의 방향을 비추는 질문입니다. 안색이 변했다는 말은 마음이 이미 몸에 나타났다는 뜻입니다. 얼굴은 마음보다 먼저 진실을 말할 때가 있습니다. 그래서 밤마다 우리는 내 표정이 무엇을 말하고 있었는지 조용히 돌아볼 필요가 있습니다.",
  "감정이 문 앞에 있다는 표현은 참 섬세합니다. 감정은 집 안으로 완전히 들어오기 전, 아직 문턱에서 기다리는 순간이 있습니다. 그때 알아차리면 늦지 않습니다. 화가 났구나. 부러웠구나. 나도 인정받고 싶었구나. 이런 문장은 감정을 쫓아내지는 못해도, 감정이 주인이 되는 것을 막아 줍니다.",
  "심리학에서 말하는 자존감은 늘 높은 기분을 뜻하지 않습니다. 오히려 흔들릴 때도 자신을 완전히 버리지 않는 힘에 가깝습니다. 비교가 찾아올 때 내 마음이 무너지는 이유는 내가 나를 평가표 하나에 올려놓기 때문입니다. 성경은 그 평가표 밖에서 우리를 다시 부릅니다.",
  "선을 행하면 낯을 들 수 있다는 말은, 마음의 어두움보다 선택이 더 깊을 수 있다는 뜻입니다. 이미 질투가 올라왔어도, 그다음 선택은 아직 남아 있습니다. 차갑게 말할지, 잠시 멈출지, 혼자 결론 내릴지, 조용히 털어놓을지. 그 작은 선택이 마음의 길을 바꿉니다.",
  "오늘의 우리는 카인처럼 들판으로 나가지는 않을지 모릅니다. 그러나 마음속에서는 누군가를 멀리 밀어낼 수 있습니다. 연락을 피하고, 축하를 삼키고, 상대의 좋은 점을 깎아내리며 마음의 거리를 벌립니다. 그래서 이 이야기는 오래된 이야기가 아니라 오늘의 이야기입니다.",
  "질투라는 단어를 부드럽게 불러 보면, 그 안에 어린 마음이 숨어 있음을 보게 됩니다. 나도 봐 주세요. 나도 소중하게 여겨 주세요. 나도 뒤처지고 싶지 않습니다. 이런 마음은 부끄럽지만 인간적입니다. 하나님 앞에서 인간적인 마음은 숨겨야 할 쓰레기가 아니라 돌보아야 할 상처가 됩니다.",
  "말하지 못한 감정은 어두운 곳에서 자랍니다. 말이 된 감정은 조금씩 빛을 받습니다. 그래서 오늘 밤 우리의 연습은 완벽한 해결이 아닙니다. 그저 내 마음을 한 문장으로 말해 보는 것입니다. 나는 비교 때문에 아팠다. 나는 사랑을 확인하고 싶었다. 이 한 문장이 들판으로 가던 발걸음을 멈추게 할 수 있습니다.",
  "네 아우가 어디 있느냐는 질문은 관계를 다시 찾으라는 초대처럼 들립니다. 마음이 아플 때 우리는 상대를 하나의 경쟁자로만 줄여 버립니다. 그러나 성경의 질문은 그 사람을 다시 형제의 자리로 돌려놓습니다. 경쟁자 이전에 사람이고, 비교 대상 이전에 함께 길을 걷는 존재입니다.",
  "책임이라는 말은 무겁게 들리지만, 관계 안에서는 방향을 회복하는 힘이 되기도 합니다. 내가 모든 것을 책임져야 한다는 뜻이 아닙니다. 다만 내 마음이 한 행동, 내 침묵이 만든 거리, 내 비교가 키운 차가움을 조금은 바라보겠다는 뜻입니다. 그 정도의 책임만으로도 회복은 시작됩니다.",
  "성경은 마음의 어두운 부분을 숨기지 않기 때문에 오히려 위로가 됩니다. 믿음의 이야기는 항상 빛나는 사람들만의 기록이 아닙니다. 흔들리고, 비교하고, 실패하고, 다시 질문 앞에 서는 사람들의 기록입니다. 그러니 오늘 우리의 마음이 복잡해도 그 자체로 버림받은 증거는 아닙니다.",
  "당신이 오늘 누군가를 부러워했다면, 그 마음을 너무 세게 벌하지 않아도 됩니다. 부러움은 때로 내가 바라는 것을 알려 주는 신호가 됩니다. 다만 그 신호를 따라 누군가를 미워하는 길로 가지 않으면 됩니다. 부러움이 알려 준 소망을 조용히 하나님 앞에 내려놓을 수 있습니다.",
  "멈춤은 대단한 결단처럼 보이지만 아주 작게 시작됩니다. 메시지를 보내기 전에 한 번 숨쉬기, 마음속 판결을 내리기 전에 하루 기다리기, 상대를 깎아내리는 말 대신 침묵을 선택하기. 이런 작은 멈춤이 죄가 문을 넘지 못하게 하는 낮은 울타리가 됩니다.",
  "떠오르는 사람이 있다면, 그 사람을 억지로 축복하지 못해도 괜찮습니다. 처음에는 그저 미움이 커지지 않게 해 달라고 기도하는 것만으로도 충분합니다. 마음은 한 번에 넓어지지 않습니다. 그러나 조금씩 덜 좁아질 수 있습니다. 그 작은 변화도 은혜의 한 방식입니다.",
  "내일 아침의 우리는 오늘 밤보다 조금 더 천천히 반응할 수 있습니다. 비교가 올라와도 바로 믿지 않고, 서운함이 생겨도 곧장 결론 내리지 않을 수 있습니다. 성숙은 감정이 없어지는 것이 아니라 감정이 말하는 모든 것을 그대로 따르지 않는 힘입니다.",
  "카인과 아벨의 들판은 멀리 있지만, 그 들판의 침묵은 우리 안에도 남아 있습니다. 다만 오늘 우리는 그 침묵을 혼자 두지 않으려 합니다. 질문을 듣고, 마음을 부르고, 관계를 다시 기억하려 합니다. 이것이 이 오래된 이야기가 밤마다 우리에게 주는 조용한 길입니다.",
  "이제 몸의 힘을 조금 풀어도 좋습니다. 오늘 붙잡고 있던 비교의 표를 내려놓습니다. 누구의 인정이 더 컸는지, 누가 더 앞섰는지, 누가 더 빛났는지를 잠시 멈춥니다. 이 밤에는 하나님 앞에서 한 사람의 마음으로 쉬어도 됩니다. 그것이면 충분합니다.",
];

const deepeningReflections = [
  "잠들기 전의 묵상은 문제를 해결하려는 시간이 아니라 마음의 속도를 낮추는 시간입니다. 그래서 우리는 카인을 멀리 밀어내지 않고, 그의 얼굴이 어두워진 순간 곁에 조용히 앉아 봅니다. 그 자리에서 우리도 배웁니다. 감정을 늦게 알아차릴수록 마음은 더 큰 소리로 말하게 된다는 것을 배웁니다.",
  "성실함이 곧 평안은 아닙니다. 열심히 했는데도 인정받지 못했다고 느끼면 마음은 더 깊이 흔들립니다. 그러니 오늘의 위로는 노력하지 않아도 된다는 말이 아닙니다. 노력한 나를 평가 하나로만 판단하지 말자는 초대입니다. 땅을 일군 손은 결과 이전에도 이미 수고한 손입니다.",
  "부족감은 자꾸 증거를 모읍니다. 저 말도 나를 무시한 것 같고, 저 표정도 나를 밀어낸 것 같고, 저 침묵도 나를 덜 사랑한다는 뜻처럼 느껴집니다. 하지만 밤의 지혜는 잠시 멈추어 묻는 것입니다. 이것은 사실인가, 아니면 아픈 마음이 붙인 해석인가.",
  "형제의 이야기는 언제나 가까운 거리의 이야기입니다. 가까움은 위로가 되지만, 동시에 비교가 가장 빨리 자라는 자리이기도 합니다. 그래서 가까운 사람 앞에서 마음이 복잡했다면 너무 놀라지 않아도 됩니다. 가까웠기 때문에 더 기대했고, 기대했기 때문에 더 아팠을 수 있습니다.",
  "하나님의 질문은 마음의 체온을 재는 손길처럼 다가옵니다. 왜 이렇게 뜨거워졌느냐고, 왜 이렇게 굳어졌느냐고 묻습니다. 그 질문 앞에서 변명보다 먼저 필요한 것은 정직입니다. 네, 제 마음이 어두워졌습니다. 네, 저는 지금 동생의 기쁨을 함께 기뻐하기가 어렵습니다.",
  "문 앞에 엎드린 감정은 사라지라고 소리친다고 사라지지 않습니다. 오히려 조용히 바라볼 때 조금씩 힘을 잃습니다. 지금 분노가 있구나. 지금 수치심이 있구나. 지금 인정받고 싶은 마음이 있구나. 이렇게 이름을 부르면 감정은 괴물이 아니라 신호가 됩니다.",
  "자존감이 약해진 밤에는 작은 말도 크게 들립니다. 누군가의 성공은 나의 실패처럼 느껴지고, 누군가의 칭찬은 나의 결핍처럼 느껴집니다. 그때 성경은 우리를 비교의 줄에서 내려오게 합니다. 너는 줄 세워진 존재가 아니라 부름받은 존재라고, 조용히 다시 말해 줍니다.",
  "아직 길이 있다는 말은 큰 위로입니다. 이미 마음이 어두워졌어도, 이미 얼굴이 굳어졌어도, 이미 속으로 누군가를 미워했어도, 그다음 걸음은 남아 있습니다. 오늘 밤 우리는 완벽한 사람이 되려는 것이 아닙니다. 다음 걸음 하나를 덜 아프게 선택하려는 것입니다.",
  "마음속 거리두기는 겉으로 잘 보이지 않습니다. 하지만 어느 날부터 상대의 이름이 불편해지고, 좋은 소식이 들릴 때 몸이 굳고, 대화가 짧아집니다. 그때 우리는 늦기 전에 마음을 살펴야 합니다. 내가 지금 관계를 지키고 있는지, 아니면 내 상처를 지키고 있는지.",
  "질투 밑에 있는 소망을 발견하면 마음이 조금 달라집니다. 나는 저 사람을 무너뜨리고 싶은 것이 아니라, 나도 의미 있게 살고 싶었던 것일 수 있습니다. 나는 빼앗고 싶은 것이 아니라, 나도 보이고 싶었던 것일 수 있습니다. 이 차이를 알면 감정의 길이 조금 부드러워집니다.",
  "마음을 문장으로 만드는 일은 기도와 닮아 있습니다. 멋진 말이 아니어도 됩니다. 하나님, 제가 비교하고 있습니다. 하나님, 제가 서운합니다. 하나님, 제가 사랑을 확인하고 싶습니다. 이런 짧은 고백은 마음의 문을 조금 엽니다. 닫힌 마음은 혼자 커지지만, 열린 마음은 도움을 받을 수 있습니다.",
  "관계가 경쟁으로 줄어들 때, 우리는 상대의 얼굴을 잃어버립니다. 아벨은 카인의 동생이었지만, 어느 순간 비교의 상징이 되었을지 모릅니다. 우리도 그럴 때가 있습니다. 누군가를 한 사람으로 보기보다 나의 부족함을 증명하는 사람으로 볼 때, 관계는 차가워집니다.",
  "책임은 나를 정죄하려는 도구가 아니라 나에게 선택권이 남아 있음을 알려 주는 말입니다. 내가 할 수 있는 것이 하나도 없다고 믿으면 마음은 더 어두워집니다. 하지만 작은 책임 하나를 붙잡으면 길이 생깁니다. 말투 하나, 거리 하나, 기도 하나를 다시 고를 수 있습니다.",
  "복잡한 마음을 숨기지 않아도 된다는 것은 큰 평안입니다. 하나님 앞에서 좋은 마음만 가져가야 한다고 생각하면 우리는 곧 지칩니다. 그러나 성경은 어두운 마음도 질문 앞에 세웁니다. 그 질문은 우리를 부끄럽게만 하지 않고, 더 깊은 정직으로 초대합니다.",
  "부러움은 방향을 잃으면 미움이 되지만, 잘 돌보면 소망의 언어가 됩니다. 내가 무엇을 바라는지, 어디에서 뒤처졌다고 느끼는지, 어떤 인정에 목말라 있었는지 알려 줍니다. 오늘 밤 그 소망을 누군가에게 겨누지 않고, 조용히 하나님 앞에 내려놓아 봅니다.",
  "멈춤의 연습은 작지만 실제적입니다. 손가락이 답장을 쓰기 전에 멈추고, 마음이 판결문을 만들기 전에 멈추고, 얼굴이 굳어질 때 숨을 고릅니다. 그 작은 멈춤은 약함이 아닙니다. 마음이 더 큰 상처를 만들기 전에 스스로를 보호하는 지혜입니다.",
  "축복이 어렵다면 중립에서 시작해도 됩니다. 저 사람도 자기 길을 걷고 있다. 저 사람의 빛이 내 빛을 끄는 것은 아니다. 저 사람에게 주어진 몫과 나에게 주어진 몫은 서로 다를 수 있다. 이런 문장들은 마음을 억지로 밝히지 않고도 어둠이 커지는 것을 막아 줍니다.",
  "내일의 변화는 아주 작을 수 있습니다. 비교가 올라올 때 휴대폰을 잠시 내려놓는 것, 누군가의 소식을 보고 곧장 자신을 평가하지 않는 것, 마음이 굳을 때 산책을 하는 것. 작지만 반복되는 선택이 마음의 길을 다시 냅니다. 성숙은 대개 그렇게 조용히 옵니다.",
  "오래된 들판의 이야기가 오늘 밤 우리에게 남기는 것은 두려움만이 아닙니다. 그것은 경고이면서 동시에 초대입니다. 마음이 어두워질 때 숨지 말라는 초대, 비교가 시작될 때 질문을 들으라는 초대, 관계가 멀어질 때 다시 형제를 기억하라는 초대입니다.",
  "마지막으로 마음속에 한 문장을 남겨 봅니다. 나는 비교보다 깊은 존재입니다. 나는 오늘 흔들렸지만, 다시 배울 수 있는 존재입니다. 이 문장이 밤의 끝에서 조용히 당신을 붙들어 주기를 바랍니다.",
];

const closingMeditations = [
  "이 대목을 천천히 붙들면, 우리는 감정을 없애는 사람이 아니라 감정의 방향을 배우는 사람이 됩니다. 비교가 올라왔다는 사실보다 중요한 것은 그 비교를 어디로 데려가느냐입니다. 미움으로 데려갈 수도 있고, 정직한 기도로 데려갈 수도 있습니다.",
  "수고가 인정으로 곧장 이어지지 않을 때 마음은 쉽게 메마릅니다. 그때 필요한 것은 더 센 자기비난이 아니라, 수고한 시간을 알아주는 조용한 시선입니다. 하나님 앞에서는 결과만 남지 않고 기다림과 땀과 견딤도 함께 기억됩니다.",
  "해석은 마음의 날씨를 바꿉니다. 같은 사건도 버림받았다는 해석을 붙이면 폭풍이 되고, 아직 배울 것이 있다는 해석을 붙이면 길이 됩니다. 카인의 이야기는 사건보다 해석이 얼마나 무서운 힘을 갖는지 보여 줍니다.",
  "가까운 사람을 경쟁자로 느끼는 순간, 우리는 외로워집니다. 함께 있어도 혼자 남겨진 것처럼 느껴집니다. 그래서 비교의 치유는 상대를 이기는 데 있지 않고, 다시 관계의 자리로 돌아오는 데 있습니다.",
  "질문을 들을 수 있는 마음은 아직 완전히 닫힌 마음이 아닙니다. 하나님이 묻고 계신다는 것은 아직 대화가 남아 있다는 뜻입니다. 아무리 어두운 감정도 질문 앞에서는 잠시 멈출 수 있습니다.",
  "감정을 다스린다는 말은 감정을 부정한다는 뜻이 아닙니다. 그것은 감정에게 운전대를 전부 넘기지 않는다는 뜻입니다. 감정은 손님으로 올 수 있지만, 집의 주인은 더 깊은 지혜와 사랑이어야 합니다.",
  "나의 가치는 누군가와 나란히 세워 비교할 때 선명해지는 것이 아닙니다. 오히려 비교의 줄에서 내려올 때 조금씩 보입니다. 나는 이긴 사람도 진 사람도 아닌, 부름을 듣는 사람입니다.",
  "작은 선택은 밤에는 작아 보여도 아침에는 길이 됩니다. 부드러운 말 하나가 하루의 방향을 바꾸고, 늦춘 반응 하나가 관계의 상처를 막습니다. 카인의 문 앞에서 우리가 배우는 것은 바로 그 작은 선택의 무게입니다.",
  "관계를 지키는 일은 감정을 숨기는 일이 아닙니다. 감정을 관계가 감당할 수 있는 언어로 바꾸는 일입니다. 그래서 말은 중요합니다. 말이 없으면 마음은 혼자 이야기를 쓰고, 혼자 쓴 이야기는 자주 어두워집니다.",
  "소망은 남을 향해 날카로워질 때 질투가 되고, 하나님 앞에서 정직해질 때 기도가 됩니다. 내가 바라는 것을 인정하면, 다른 사람의 좋은 소식이 내 존재를 지우는 사건이 아니라는 것을 조금씩 배울 수 있습니다.",
  "고백은 마음을 작게 만드는 일이 아닙니다. 오히려 마음을 현실로 데려오는 일입니다. 말할 수 없는 감정은 그림자가 되지만, 말해진 감정은 돌봄을 받을 수 있는 모양이 됩니다.",
  "형제를 다시 기억한다는 것은 상대를 이상화한다는 뜻이 아닙니다. 그 사람도 나처럼 두려움과 바람을 가진 존재라는 사실을 떠올리는 것입니다. 그 기억이 경쟁의 날을 조금 무디게 합니다.",
  "책임의 첫 걸음은 거창하지 않습니다. 내 안에서 시작된 차가움을 알아차리는 것, 내 말이 만든 거리를 보는 것, 내가 붙든 비교의 이야기를 다시 쓰는 것입니다. 그 정도면 회복은 이미 방향을 얻습니다.",
  "믿음은 마음의 어두움을 삭제하지 않습니다. 믿음은 그 어두움 안에서도 질문을 듣고, 다시 돌아갈 길을 찾게 합니다. 그래서 이 이야기는 실패의 기록이면서 동시에 돌아섬의 가능성을 품은 기록입니다.",
  "부러움이 알려 준 소망을 조용히 적어 보는 것도 좋습니다. 나는 무엇을 원했나. 나는 누구에게 인정받고 싶었나. 나는 어떤 말 한마디를 기다렸나. 이런 질문은 질투를 공격이 아니라 이해의 문으로 바꿉니다.",
  "멈춤은 마음의 속도를 하나님께 맞추는 일입니다. 급한 감정은 당장 결론을 원하지만, 지혜는 조금 더 넓은 시간을 요청합니다. 밤은 그 넓은 시간을 연습하기에 좋은 자리입니다.",
  "중립의 문장을 반복하다 보면 마음은 서서히 적대에서 내려옵니다. 저 사람의 기쁨이 내 실패는 아니다. 저 사람의 길과 내 길은 다르다. 이 단순한 문장들이 비교의 불을 조금 낮춥니다.",
  "성숙은 큰 장면보다 작은 반복에서 자랍니다. 오늘 한 번 멈추고, 내일 한 번 덜 비교하고, 모레 한 번 더 부드럽게 말하는 것. 그렇게 마음은 어느새 다른 길을 기억하게 됩니다.",
  "오래된 이야기가 계속 읽히는 이유는 우리 안에 아직 같은 질문이 살아 있기 때문입니다. 내가 화난 이유는 무엇인가. 내가 잃을까 두려워한 것은 무엇인가. 나는 지금 누구를 형제로 보지 못하고 있는가.",
  "쉼은 포기가 아닙니다. 오늘 해결하지 못한 마음을 밤새 붙들고 싸우지 않겠다는 믿음의 선택입니다. 내일 다시 볼 수 있도록, 오늘은 잠시 내려놓습니다. 고요한 숨 안에서 마음이 천천히 가라앉습니다.",
];

const gentleAnchors = [
  "이 한 문장만 남겨도 충분합니다. 마음은 비교보다 느리게 회복되어도 괜찮습니다.",
  "숨을 조금 길게 내쉬며, 지금의 나를 평가하지 않고 바라봅니다.",
  "아픈 해석은 잠시 내려놓고, 사실과 감정을 천천히 구분해 봅니다.",
  "가까운 사람 앞에서 흔들린 마음도 돌봄을 받을 수 있습니다.",
  "질문은 벌이 아니라 돌아올 길을 비추는 작은 등불일 수 있습니다.",
  "문 앞의 감정을 알아차리는 것만으로도 이미 다른 길이 열립니다.",
  "나는 비교표 위의 이름이 아니라, 오늘도 불림받는 한 사람입니다.",
  "작은 선택 하나가 마음의 방향을 부드럽게 바꿀 수 있습니다.",
  "관계를 지키는 말은 대개 낮고 천천히 시작됩니다.",
  "소망을 미움으로 보내지 않고 기도로 돌려보낼 수 있습니다.",
  "짧은 고백 하나가 어두운 마음에 숨 쉴 틈을 만듭니다.",
  "형제의 얼굴을 다시 기억하면 경쟁의 그림자가 조금 옅어집니다.",
  "책임은 무거운 돌이 아니라 돌아갈 길을 알려 주는 표지일 수 있습니다.",
  "복잡한 마음도 숨지 않고 빛 앞에 설 수 있습니다.",
  "부러움이 알려 준 바람을 조용히 인정해도 괜찮습니다.",
  "멈춤은 약함이 아니라 마음을 보호하는 지혜입니다.",
  "중립의 문장 하나가 미움의 속도를 늦출 수 있습니다.",
  "반복되는 작은 선택이 내일의 평안을 준비합니다.",
  "오래된 질문은 오늘의 마음에도 조용히 길을 냅니다.",
  "이제 남은 긴장은 밤의 고요 속에 천천히 맡겨 둡니다.",
];

const lateSegmentAnchors = [
  "이 생각은 마음을 몰아세우지 않고, 다시 말할 수 있는 자리를 조용히 마련합니다.",
  "작은 문장 하나가 닫힌 마음에 부드러운 틈을 내어 줄 수 있습니다.",
  "관계를 향한 시선이 천천히 돌아오면, 비교의 소리도 조금 낮아집니다.",
  "이 장면은 책임을 벌처럼 들려주지 않고 회복의 시작처럼 보여 줍니다.",
  "부러움의 밑자리를 살피면, 미움보다 깊은 바람을 만날 수 있습니다.",
  "멈춤의 호흡은 오늘의 감정을 내일의 상처로 옮기지 않게 돕습니다.",
  "중립의 말 한마디가 마음속 날카로운 판단을 잠시 쉬게 합니다.",
  "작은 반복이 쌓이면 마음은 전과 다른 길을 기억하기 시작합니다.",
  "오래된 질문은 지금의 관계를 다시 사람답게 바라보게 합니다.",
  "마지막 쉼은 마음의 힘을 되찾는 시간입니다.",
];

const expandedParagraphs = paragraphs.map((paragraph, index) => (
  varyWatchPhrases(`${paragraph} ${reflections[index]} ${deepeningReflections[index]} ${closingMeditations[index]} ${gentleAnchors[index]} ${index >= 10 ? lateSegmentAnchors[index - 10] : ""}`, index)
));
const script = expandedParagraphs.join("\n\n");
const quality = assertLongformScriptQuality(script, {
  minParagraphs: 18,
  maxRepeatedStart: 3,
  maxRepeatedSentence: 2,
});
if (!quality.ok) {
  console.error(JSON.stringify(quality, null, 2));
  throw new Error("20-minute sample script quality gate failed");
}

const segmentScripts = splitEvenlyByParagraphs(expandedParagraphs, segmentPlan.segments.length);
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
  // 세그먼트 문단 기준을 전체 대본 목표(라이브러리 기본값 90)에서 세그먼트 길이 비율만큼 배분한다.
  // 예전 Math.max(8, round(duration/60)) 공식은 전체 기준(90)보다 훨씬 느슨해서,
  // 세그먼트 단위로는 통과하지만 전체로는 문단 밀도가 부족한 대본이 렌더까지 갈 수 있었다.
  const wholeScriptMinParagraphs = 90;
  const segmentMinParagraphs = Math.max(
    8,
    Math.round((segment.durationSeconds / targetSeconds) * wholeScriptMinParagraphs),
  );
  const qualityReport = assertLongformScriptQuality(segmentScript, {
    minParagraphs: segmentMinParagraphs,
    maxRepeatedStart: 3,
    maxRepeatedSentence: 2,
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
    visualStyle: "strict pure black and white grayscale biblical oil painting",
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
writeFileSync(join(exportDir, "production.json"), JSON.stringify({
  slug,
  title,
  targetSeconds,
  segmentMinutes: segmentPlan.segmentMinutes,
  segmentCount: segmentPlan.segments.length,
  totalSceneCount: segmentPlan.totalSceneCount,
  scriptQuality: quality,
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
  slug,
  targetSeconds,
  segmentCount: segmentRecords.length,
  totalSceneCount: segmentPlan.totalSceneCount,
  chars: script.length,
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

function splitEvenlyByParagraphs(items, count) {
  const groups = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * items.length) / count);
    const end = Math.floor(((i + 1) * items.length) / count);
    groups.push(items.slice(start, Math.max(start + 1, end)));
  }
  return groups;
}

function splitTextIntoScenes(text, sceneCount) {
  const sentences = String(text)
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const source = sentences.length >= sceneCount ? sentences : String(text).split(/\n\s*\n/).filter(Boolean);
  const scenes = [];
  for (let i = 0; i < sceneCount; i += 1) {
    const start = Math.floor((i * source.length) / sceneCount);
    const end = Math.floor(((i + 1) * source.length) / sceneCount);
    const chunk = source.slice(start, Math.max(start + 1, end)).join(" ");
    scenes.push(chunk.trim());
  }
  return scenes;
}

function buildStoryboard(sceneTexts, timeline, segmentIndex, contextCards = []) {
  const motifs = [
    "ancient field with two stone altars under a moonlit sky",
    "rough hands holding dark soil beside quiet furrows",
    "two brothers seen as distant silhouettes in a wide field",
    "a stone threshold divided by shadow and pale light",
    "a lone figure standing before a silent doorway at night",
    "still water reflecting a small falling stone",
    "empty field after footsteps have crossed the dust",
    "a narrow path between dark hills and a pale horizon",
    "open hands resting on soil beside a small clay bowl",
    "two lamps burning at different brightness in a tent",
  ];
  const cameras = [
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
    "small firelight rendered only in grayscale",
    "thin overhead light",
  ];
  const moods = [
    "quiet and contemplative",
    "hurt but restrained",
    "solemn and compassionate",
    "restful and reflective",
    "peaceful and consoling",
  ];
  const lines = [];
  for (const [index, text] of sceneTexts.entries()) {
    const camera = cameras[index % cameras.length];
    const light = lighting[index % lighting.length];
    const mood = moods[index % moods.length];
    const duration = timeline[index]?.durationSeconds || 30;
    const card = contextCards[index] || buildSceneContextCard({ narration: text, order: index + 1, topic: `${title} ${slug}` });
    const prompt = compileContextPrompt({
      card,
      style: [
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
    lines.push(`${prompt} / ${camera} / ${light} / ${mood} / subtle slow Ken Burns movement / duration:${duration}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function stamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);
}

function varyWatchPhrases(text, index) {
  const alternatives = ["이 밤", "고요한 시간", "잠시", "지금", "늦은 시간"];
  if (index % 2 === 0) {
    return text.replace(/오늘 밤/g, alternatives[index % alternatives.length]);
  }
  return text.replace(/오늘 밤/g, (match, offset) => (
    offset % 2 === 0 ? alternatives[(index + 1) % alternatives.length] : match
  ));
}
