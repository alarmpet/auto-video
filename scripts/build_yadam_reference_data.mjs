// scripts/build_yadam_reference_data.mjs
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, sha256Bytes } from "./lib/pipeline/canonical-json.mjs";
import { writeCanonicalJson } from "./lib/pipeline/atomic-store.mjs";

const SOURCE_LOCK = Object.freeze({
  "module/name_bank.md": "decc9b0ba9170070aea3ae8f86a565ce26689388f643c3cf086fabdc54044550",
  "module/prompt_v5.2_sonnet.md": "af2b889f671223e71c002c440387dd23ac7f4d56d89bdc465ba4ffe15226b172",
  "module/대본 sonnet/motif_bank.md": "63040be623dee5b271d1d38065171eed98a7774976e91a0c7ae087ed8ed64fb1",
  "module/대본 sonnet/name_bank.md": "decc9b0ba9170070aea3ae8f86a565ce26689388f643c3cf086fabdc54044550",
  "module/대본 sonnet/scripts.md": "601791acc8de7ea464ef51b0e81b4e6b7ebd6566d1cd3f9b5dcc4832e376e1fc",
  "module/대본 sonnet/v11.3_main_SONNET.md": "c013599c4343cd5aecede2b20783d2ab4c2ca8b049a222be561b8e5b662cfcb5",
  "module/대본 sonnet/부록_양식.md": "f484e9c5e07de7c610dac1f55a42d28d07bc5bb8b79d622081ed76b284be98fe",
  "module/대본 sonnet/참고_비트구조_체크리스트_slim.md": "0ed5659828eb554649e4a619d4fbc4b4150d75e6d743d90aaef070a3343bbbd5",
  "module/대본 sonnet/참고_인트로_제목_가이드_slim.md": "09323e2035e4d6794c844d3e97a1a024476b23289995da3538a20cb20c243b20",
  "module/대본 sonnet/참고_장르별_요소풀_slim.md": "ab8ec00709d181a50551dc1b89115607fb6d43edcb5aff59397630cdb4e8c4a9",
  "module/대본 sonnet/참고_캐릭터_말투_문체_slim.md": "d25c7f0d4f5d0561b8ff42156fce98168ee9160ece1c3a8a9b06d2437e791256",
  "module/시스템프롬프트_Sonnet.txt": "6cad802444c51daf009e9d47de7a140224d01cb4097a3b0bf87cb590a85d4ab9",
  "module/썸네일 프롬프트 (opus) 260601.md": "fe6b08667f91aa17cd7ca29a259c16e2edf927faf6db2e29cdc9f892a1fd0e25",
});

const NOBLEWOMAN_POOL_RULES = Object.freeze({
  public_address: { label: "호칭", expectedCount: 4 },
  taekho: { label: "택호", expectedCount: 8 },
  legal_given_name: { label: "본명", expectedCount: 15 },
});

function splitValues(value) {
  return value
    .replaceAll(/\*\*/gu, "")
    .split(",")
    .map((item) => item.trim().normalize("NFC"))
    .filter(Boolean);
}

function parseNoblewomanPools(markdown) {
  const addressLine = markdown.match(/- 호칭·택호 \(우선\): ([^\r\n]+)/u)?.[1];
  const legalLine = markdown.match(/- 본명 \(필요시\): ([^\r\n]+)/u)?.[1];
  if (!addressLine || !legalLine) throw new Error("name_bank noblewoman rows missing");
  const [addressPart, taekhoPart] = addressLine.split("/").map((value) => value.trim());
  const pools = {
    public_address: splitValues(addressPart),
    taekho: splitValues(taekhoPart),
    legal_given_name: splitValues(legalLine),
  };
  for (const [poolId, rule] of Object.entries(NOBLEWOMAN_POOL_RULES)) {
    if (pools[poolId].length !== rule.expectedCount) {
      throw new Error(`${poolId} expected ${rule.expectedCount}, received ${pools[poolId].length}`);
    }
  }
  return pools;
}

const DESIGN_RULES = Object.freeze({
  targetMinutes: { minimum: 10, maximum: 120, step: 10 },
  logicalSegmentMinutes: 10,
  intro: { sentenceCount: 6, minimumCharacters: 200, maximumCharacters: 350, ctaSentence: 6 },
  counts: { beats: 15, twists: 6, emotionalPoints: 6, themePlacements: 3, finaleStages: 5 },
  titleSuffix: " | 야담 옛날이야기 민담 전설 설화",
  fixedEnding: [
    "다음 영상을 빠르게 만나보시려면 좋아요와 구독을 눌러주세요.",
    "지금 화면에 나오는 더 재미있는 영상들도 함께 해주세요.",
    "그럼 모두 행복한 하루 보내세요. 감사합니다.",
  ],
});

async function main() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("Usage: node scripts/build_yadam_reference_data.mjs [--write | --check]");
    process.exit(1);
  }

  // 1. Verify and read all source hashes
  const sourceHashes = [];
  for (const [path, expectedHash] of Object.entries(SOURCE_LOCK)) {
    const bytes = await readFile(path);
    const actualHash = sha256Bytes(bytes);
    if (actualHash !== expectedHash) {
      console.error(`Hash mismatch for ${path}: expected ${expectedHash}, got ${actualHash}`);
      process.exit(1);
    }
    sourceHashes.push({ path, sha256: actualHash });
  }

  // 2. Parse name_bank
  const nameBankMd = await readFile("module/name_bank.md", "utf8");
  
  // 0. Blocked list
  const blockedMatch = nameBankMd.match(/## 0\. 차단 목록 [^\r\n]*\r?\n([^\r\n]+)/u);
  if (!blockedMatch) throw new Error("Blocked list missing in name_bank.md");
  const blockedRaw = blockedMatch[1];
  const blockedItems = [];
  for (const item of blockedRaw.split(",").map(s => s.trim().normalize("NFC"))) {
    if (item.endsWith("(이)")) {
      const base = item.slice(0, -3);
      blockedItems.push(base);
      blockedItems.push(base + "이");
    } else {
      blockedItems.push(item);
    }
  }

  // 1. Slaves
  const slaveFemaleMatch = nameBankMd.match(/### 여성\r?\n([^\r\n#]+)/u);
  const slaveMaleMatch = nameBankMd.match(/### 남성\r?\n([^\r\n#]+)/u);
  const slaveFemaleNames = splitValues(slaveFemaleMatch[1]);
  const slaveMaleNames = splitValues(slaveMaleMatch[1]);

  // 2. Commoners (parsed from the section under ## 2. 평민·상민)
  const commonerSec = nameBankMd.split("## 2. 평민·상민 (양인)")[1].split("## 3. 중인")[0];
  const commonerFemaleMatch = commonerSec.match(/### 여성\r?\n([^\r\n#]+)/u);
  const commonerMaleMatch = commonerSec.match(/### 남성\r?\n([^\r\n#]+)/u);
  const commonerFemaleNames = splitValues(commonerFemaleMatch[1]);
  const commonerMaleNames = splitValues(commonerMaleMatch[1]);

  // 3. Middle class
  const middleClassSec = nameBankMd.split("## 3. 중인 (역관·의관·서리·아전)")[1].split("## 4. 양반·사대부")[0];
  const middleClassNames = splitValues(middleClassSec);

  // 4. Nobleman (남성)
  const noblemanSec = nameBankMd.split("## 4. 양반·사대부")[1].split("## 5. 기생")[0];
  const noblemanMaleMatch = noblemanSec.match(/### 남성\r?\n([^\r\n#]+)/u);
  const noblemanNames = splitValues(noblemanMaleMatch[1]);

  // 4. Noblewoman (여성) - use the specific parser
  const noblewomanPools = parseNoblewomanPools(nameBankMd);

  // 5. Gisaeng
  const gisaengSec = nameBankMd.split("## 5. 기생 (예명)")[1].split("## 6. 승려")[0];
  const gisaengNames = splitValues(gisaengSec);

  // 6. Monk
  const monkSec = nameBankMd.split("## 6. 승려 (법명)")[1].split("## 7. 왕실")[0];
  const monkNames = splitValues(monkSec);

  // 7. Royal
  const royalSec = nameBankMd.split("## 7. 왕실·궁중")[1].split("## 8. 성씨")[0];
  const royalFemaleMatch = royalSec.match(/- 상궁·나인 \(필요시\): ([^\r\n]+)/u);
  const royalMaleMatch = royalSec.match(/- 내관 \(필요시\): ([^\r\n]+)/u);
  const royalFemaleNames = splitValues(royalFemaleMatch[1]);
  const royalMaleNames = splitValues(royalMaleMatch[1]);

  // 8. Surnames
  const surnameSec = nameBankMd.split("## 8. 성씨 풀")[1].split("---")[0];
  const surnameEasyMatch = surnameSec.match(/- \*\*읽기 쉬운 성씨 [^:]+:\*\* ([^\r\n]+)/u);
  const surnameRareMatch = surnameSec.match(/- \*\*드물고 어려운 성씨 [^:]+:\*\* ([^\r\n]+)/u);
  const surnameCompoundMatch = surnameSec.match(/- \*\*복성 [^:]+:\*\* ([^\r\n]+)/u);
  const surnameEasy = splitValues(surnameEasyMatch[1]);
  const surnameRare = splitValues(surnameRareMatch[1]);
  const surnameCompound = splitValues(surnameCompoundMatch[1]);

  const entries = [];
  const pools = {};

  function addPoolEntries(classId, subcategory, namesList, gender, useCase, requiresSurname, difficulty) {
    const poolKey = `${classId}:${subcategory}`;
    const list = [];
    namesList.forEach((nameStr, idx) => {
      const ordinal = idx + 1;
      const entry = {
        id: `name:${classId}:${subcategory}:${String(ordinal).padStart(3, "0")}`,
        classId,
        gender,
        useCase,
        spokenForm: nameStr,
        requiresSurname,
        difficulty
      };
      entries.push(entry);
      list.push(entry);
    });
    if (!pools[classId]) pools[classId] = {};
    pools[classId][subcategory] = list;
  }

  // Populate Name Pools
  addPoolEntries("slave", "female", slaveFemaleNames, "female", "givenName", false, "easy");
  addPoolEntries("slave", "male", slaveMaleNames, "male", "givenName", false, "easy");
  addPoolEntries("commoner", "female", commonerFemaleNames, "female", "givenName", true, "easy");
  addPoolEntries("commoner", "male", commonerMaleNames, "male", "givenName", true, "easy");
  addPoolEntries("middle_class", "male", middleClassNames, "male", "givenName", true, "easy");
  addPoolEntries("nobleman", "male", noblemanNames, "male", "givenName", true, "easy");
  addPoolEntries("noblewoman", "public_address", noblewomanPools.public_address, "female", "public_address", false, "easy");
  addPoolEntries("noblewoman", "taekho", noblewomanPools.taekho, "female", "taekho", false, "easy");
  addPoolEntries("noblewoman", "legal_given_name", noblewomanPools.legal_given_name, "female", "legal_given_name", true, "easy");
  addPoolEntries("gisaeng", "female", gisaengNames, "female", "givenName", false, "easy");
  addPoolEntries("monk", "neutral", monkNames, "neutral", "givenName", false, "easy");
  addPoolEntries("royal", "female", royalFemaleNames, "female", "givenName", false, "easy");
  addPoolEntries("royal", "male", royalMaleNames, "male", "givenName", false, "easy");
  addPoolEntries("surname", "easy", surnameEasy, "neutral", "surname", false, "easy");
  addPoolEntries("surname", "rare", surnameRare, "neutral", "surname", false, "rare");
  addPoolEntries("surname", "compound", surnameCompound, "neutral", "surname", false, "compound");

  // Blocked names
  const blockedList = blockedItems.map((nameStr, idx) => {
    const entry = {
      id: `blocked:${idx + 1}`,
      classId: "blocked",
      gender: "any",
      useCase: "blocked",
      spokenForm: nameStr,
      requiresSurname: false,
      difficulty: "normal"
    };
    entries.push(entry);
    return entry;
  });
  pools.blocked = blockedList;

  const namesJsonData = {
    schemaVersion: "1.0.0",
    sources: [
      { path: "module/name_bank.md", sha256: SOURCE_LOCK["module/name_bank.md"] },
      { path: "module/대본 sonnet/name_bank.md", sha256: SOURCE_LOCK["module/대본 sonnet/name_bank.md"] }
    ],
    pools,
    entries
  };

  // 3. Parse motif_bank
  const motifBankMd = await readFile("module/대본 sonnet/motif_bank.md", "utf8");
  const lines = motifBankMd.split(/\r?\n/);
  let part1Active = false;
  const motifsList = [];
  let ordinalCounter = 1;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## 파트 1")) {
      part1Active = true;
      continue;
    }
    if (trimmed.startsWith("## 파트 2")) {
      part1Active = false;
      continue;
    }
    if (part1Active && trimmed.startsWith("-")) {
      const match = trimmed.match(/^-\s*([◎○△])\s*(.*?)\s*\[(초자연|관계|능력|신분)\]\s*$/u);
      if (match) {
        const popularity = match[1];
        const rawDesc = match[2].trim();
        const category = match[3].normalize("NFC");
        
        motifsList.push({
          ordinal: ordinalCounter,
          id: `motif:m${String(ordinalCounter).padStart(2, "0")}`,
          description: rawDesc,
          popularity,
          category
        });
        ordinalCounter++;
      }
    }
  }

  if (motifsList.length !== 40) {
    throw new Error(`Expected exactly 40 motifs, but found ${motifsList.length}`);
  }

  const motifsJsonData = {
    schemaVersion: "1.0.0",
    sources: [
      { path: "module/대본 sonnet/motif_bank.md", sha256: SOURCE_LOCK["module/대본 sonnet/motif_bank.md"] }
    ],
    motifs: motifsList
  };

  // 4. Build beat-structure
  const beatsList = [
    { beat: 1, beatId: "beat-01", label: "오프닝 이미지", recommendedRatio: 0.03, narrativeFunction: "옛날 옛적 [구체 지역]에… 시작. 주인공 외적 상태 + 결핍.", evidenceRequirements: "⑮와 대척점" },
    { beat: 2, beatId: "beat-02", label: "주제 명시", recommendedRatio: 0.04, narrativeFunction: "누군가 주인공에게 주제 대사. 주인공 무시·이해 못함. 엔딩에서 울림", evidenceRequirements: "주제 대사 삽입" },
    { beat: 3, beatId: "beat-03", label: "설정", recommendedRatio: 0.11, narrativeFunction: "일상 세계 + 주요 인물 소개 + 약점/결핍 에피소드 + 악역 암시", evidenceRequirements: "일상 에피소드" },
    { beat: 4, beatId: "beat-04", label: "기폭제", recommendedRatio: 0.04, narrativeFunction: "외부에서 찾아온 결정적 사건. 일상 불가능", evidenceRequirements: "외부 사건 사건" },
    { beat: 5, beatId: "beat-05", label: "토론", recommendedRatio: 0.08, narrativeFunction: "새 상황 저항(두려움/의심). 주변 인물 조언·만류·부추김", evidenceRequirements: "저항 및 조언" },
    { beat: 6, beatId: "beat-06", label: "2막 진입", recommendedRatio: 0.03, narrativeFunction: "주인공 능동적·돌이킬 수 없는 결정", evidenceRequirements: "능동적 결정" },
    { beat: 7, beatId: "beat-07", label: "B스토리", recommendedRatio: 0.06, narrativeFunction: "긴장 완화 + 조력자 유대. 주제 전달. 3막 해결 씨앗", evidenceRequirements: "조력자 유대" },
    { beat: 8, beatId: "beat-08", label: "재미와 놀이", recommendedRatio: 0.18, narrativeFunction: "전제가 가장 빛나는 구간. 에피소드 최소 4개, 다른 장소·상대·상황", evidenceRequirements: "다양한 에피소드" },
    { beat: 9, beatId: "beat-09", label: "중간점", recommendedRatio: 0.04, narrativeFunction: "가짜 승리 또는 가짜 패배. ⑪과 한 쌍", evidenceRequirements: "가짜 상태" },
    { beat: 10, beatId: "beat-10", label: "악당의 역습", recommendedRatio: 0.12, narrativeFunction: "악역 강화 3단계: 약점 파악→동맹 공격/이간질→최후 수단", evidenceRequirements: "악역 3단계" },
    { beat: 11, beatId: "beat-11", label: "절망의 순간", recommendedRatio: 0.03, narrativeFunction: "모든 것을 잃음. 무언가 죽어야 함(사람/관계/신념/상징물)", evidenceRequirements: "상징물 죽음" },
    { beat: 12, beatId: "beat-12", label: "영혼의 어두운 밤", recommendedRatio: 0.04, narrativeFunction: "바닥에서 자기 대면. ② 주제 대사 회상하며 깨달음", evidenceRequirements: "주제 깨달음" },
    { beat: 13, beatId: "beat-13", label: "3막 진입", recommendedRatio: 0.02, narrativeFunction: "A+B스토리 결합. B스토리 교훈/관계가 해결 열쇠", evidenceRequirements: "해결 열쇠 결합" },
    { beat: 14, beatId: "beat-14", label: "피날레", recommendedRatio: 0.13, narrativeFunction: "5단계: 대면→진실증명→악역몰락(폭로→변명실패→측근배신→심판)→형벌→보상", evidenceRequirements: "피날레 5단계" },
    { beat: 15, beatId: "beat-15", label: "마지막 이미지", recommendedRatio: 0.02, narrativeFunction: "①의 대척점. 주인공 변화", evidenceRequirements: "① 대척점 이미지" }
  ];

  const beatsJsonData = {
    schemaVersion: "1.0.0",
    sources: {
      beatChecklistSha256: SOURCE_LOCK["module/대본 sonnet/참고_비트구조_체크리스트_slim.md"],
      introGuideSha256: SOURCE_LOCK["module/대본 sonnet/참고_인트로_제목_가이드_slim.md"]
    },
    ...DESIGN_RULES,
    beats: beatsList
  };

  // 5. Build script-rules
  const rulesJsonData = {
    schemaVersion: "1.0.0",
    sourceDispositionVersion: "2026-07-16",
    sources: sourceHashes,
    genreElementPools: [
      {
        genre: "권선징악",
        protagonists: ["장터 팔려가는 아이", "구박 막내 며느리", "천대 서자/서녀", "벙어리 행세 천재", "누명 충신 자녀", "광대패 고아", "맹인 전직 관리"],
        trials: ["친척 재산 강탈", "계모/시어머니 구박", "누명 쫓겨남", "종으로 팔림", "가짜 족보", "은인의 함정", "생사 내기"],
        reversals: {
          status: ["정승·대감 자녀", "신분 증표", "헤어진 부모 재회", "왕실 혈육"],
          ability: ["숨겨진 천재성", "무예", "천재 문장가", "동물·자연 능력"],
          relationship: ["왕이 진실 알아봄", "적이 보호자", "미워하던 자가 친부모", "악역 하수인 양심"],
          supernatural: ["꿈 계시", "죽은 자 편지·유언", "천재지변이 진실 드러냄"]
        },
        resolutions: ["가문 회복+악인 전락", "왕 인정 벼슬", "귀한 혼사", "악역 용서", "벼슬 거절 자유"]
      },
      {
        genre: "귀신·도깨비",
        protagonists: ["순박한 나무꾼", "겁 많은 선비", "가난한 농부", "효심 청년", "약초 소녀", "무덤지기"],
        supernaturalEntities: ["처녀 귀신", "도깨비", "구미호", "저승사자", "산신령", "죽은 가족 혼령", "물귀신", "봉인 풀린 악령"],
        trials: ["폐가 하룻밤", "숲 길 잃음", "저승 다녀옴", "도깨비 씨름", "금기 저주", "매일 같은 꿈", "마을 재앙"],
        resolutions: ["한 풀고 보답", "도깨비 보물", "욕심 벌", "정직 복", "알고 보니 은인", "비리 폭로"]
      },
      {
        genre: "해학·풍자",
        protagonists: ["꾀 많은 머슴", "영악한 장사꾼", "입담 건달", "봉이 김선달류", "과부", "약장수", "가짜 도사"],
        targets: ["허세 양반", "인색 부자", "거드름 원님", "탐욕 상인", "구두쇠", "뇌물 관리", "두 사기꾼 대결"],
        tricks: ["없는 것 팔기", "말장난 비틀기", "가짜 보물 소문", "규칙 허점", "자존심 심리전", "글자 그대로 계약", "가짜 예언"],
        resolutions: ["양반 망신+유유히", "구두쇠 털림", "마을 박장대소", "의적형", "속임수가 진짜 기적"]
      },
      {
        genre: "사랑·비극",
        couples: ["양반+천민", "선비+기생", "전쟁 헤어진 부부", "원수 집안 자녀", "병든 아내+약 구하는 남편", "적국 포로+처녀"],
        trials: ["신분 차이 반대", "전쟁 생이별", "시한부", "강제 혼사", "거짓 소문", "은인 의리 vs 사랑", "나라 위해 포기"],
        tokens: ["쪽빛 노리개", "비녀 반쪽", "부채", "함께 심은 나무", "두 피리", "마지막 편지"],
        resolutions: ["나비·새·꽃 환생", "오랜 기다림 재회", "돌·나무", "후손이 완성", "전설"]
      },
      {
        genre: "역사 인물",
        figures: ["어린 이순신", "젊은 정약용", "소년 세종", "허준", "장영실", "김만덕", "어린 유관순", "정조+장용영"],
        trials: ["어린 시절 천재성", "지혜 위기 극복", "백성 사랑", "실패 딛고", "권력자 직언 위기", "신분 벽 돌파", "국난 리더십"]
      },
      {
        genre: "미스터리·추리",
        protagonists: ["포도청 나졸", "은퇴 형방", "약방 주인", "점쟁이", "의녀", "젊은 현감", "유배 관리"],
        trials: ["밀실 시신", "연쇄 실종", "유언장 위조", "독살", "관아 금고 도난", "공물 실종", "죽은 자 편지"],
        mechanics: ["시신 미세 흔적", "알리바이 허점", "엇갈리는 증언", "범인만 아는 정보 실수", "글씨체", "약재·독", "시간 모순"],
        reversals: ["피해자가 가해자", "의심 안 가는 자", "사건 2개", "동기 보호", "가까이에 답"],
        resolutions: ["정의", "누명 해소", "씁쓸한 진실", "자수+사연", "더 큰 음모"]
      },
      {
        genre: "가족·성장",
        protagonists: ["불효자", "형 밀리는 둘째", "과부 어머니", "양자", "부모 모시기 싫은 삼형제", "살림 딸", "계모+전처 자식"],
        trials: ["편애", "유산 분배", "소원 소원", "너를 위한 거다 강압", "진로 세대", "오해→진실→화해", "가난 속 희생", "부모 사연"],
        tokens: ["아버지 연장", "어머니 삼베", "할머니 장독", "가훈", "감나무", "편지·유품"],
        resolutions: ["오해 풀림", "효 실천", "형제 응원", "세대 잇기", "정이 가장 큰 것"]
      }
    ],
    speechRegisters: [
      { role: "주인공(선량)", register: "~하옵니다, ~이옵니다", details: "또박또박, 담담, 짧게" },
      { role: "악역", register: "~하시오, ~란 말이오", details: "고압적, 비꼼, 협박" },
      { role: "권력자", register: "~하라, ~이니라", details: "위엄, 간결" },
      { role: "조력자/노인", register: "~느니라, ~이니라", details: "깊이, 은유" },
      { role: "구경꾼", register: "~대, ~래", details: "수군거림, 감탄" },
      { role: "추리 주인공", register: "~이오, ~하시오", details: "논리적, 질문형" },
      { role: "가족 갈등", register: "반말/존대 오감", details: "감정 폭발, 진심 못 함" }
    ],
    derogatoryCountLimit: 2,
    narrationRules: {
      basicForm: "~습니다 ↔ ~지요 교차",
      maxConsecutiveSeumnida: 2,
      maxConsecutiveAnyEnding: 2,
      maxContinuousNarrationChars: 500
    },
    signalTokens: [
      { category: "신체 표식", examples: ["등의 점 세 개", "발바닥 붉은 반점", "어깨 화상", "손목 쌍점", "이마 흉터"] },
      { category: "의복/천", examples: ["태보 반쪽", "수놓은 천 조각", "문양 노리개", "어머니가 짠 삼베"] },
      { category: "문서/서찰", examples: ["밀봉 유서", "호적 기록", "사찰 기탁 문서", "관아 출생 기록"] },
      { category: "가문 기물", examples: ["가문 비녀/반지/도장", "깨진 거울 반쪽", "어머니 은장도"] },
      { category: "기억/증언", examples: ["유모 증언", "특정 자장가", "유모만 아는 버릇"] },
      { category: "기술/습관", examples: ["가문 검법", "특정 요리법", "말버릇", "가문 글씨체"] }
    ]
  };

  const nameBankPath = "data/yadam/reference/name-bank.v1.json";
  const motifBankPath = "data/yadam/reference/motif-bank.v1.json";
  const beatStructurePath = "data/yadam/reference/beat-structure.v1.json";
  const scriptRulesPath = "data/yadam/reference/script-rules.v1.json";

  if (mode === "--write") {
    await mkdir("data/yadam/reference", { recursive: true });
    await writeCanonicalJson(nameBankPath, namesJsonData);
    await writeCanonicalJson(motifBankPath, motifsJsonData);
    await writeCanonicalJson(beatStructurePath, beatsJsonData);
    await writeCanonicalJson(scriptRulesPath, rulesJsonData);
    console.log("ok - yadam reference data is current");
  } else if (mode === "--check") {
    const nameBankFile = await readFile(nameBankPath, "utf8");
    const motifBankFile = await readFile(motifBankPath, "utf8");
    const beatStructureFile = await readFile(beatStructurePath, "utf8");
    const scriptRulesFile = await readFile(scriptRulesPath, "utf8");

    const expectedNameBank = `${canonicalJson(namesJsonData)}\n`;
    const expectedMotifBank = `${canonicalJson(motifsJsonData)}\n`;
    const expectedBeatStructure = `${canonicalJson(beatsJsonData)}\n`;
    const expectedScriptRules = `${canonicalJson(rulesJsonData)}\n`;

    if (nameBankFile !== expectedNameBank) {
      console.error(`${nameBankPath} differs from generated content`);
      process.exit(1);
    }
    if (motifBankFile !== expectedMotifBank) {
      console.error(`${motifBankPath} differs from generated content`);
      process.exit(1);
    }
    if (beatStructureFile !== expectedBeatStructure) {
      console.error(`${beatStructurePath} differs from generated content`);
      process.exit(1);
    }
    if (scriptRulesFile !== expectedScriptRules) {
      console.error(`${scriptRulesPath} differs from generated content`);
      process.exit(1);
    }
    console.log("ok - yadam reference data is current");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
