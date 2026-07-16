# scripts.md — 검증 코드 모음

매 챕터 작성 후 `check_chapter_lite()` 자동 실행. 합본 후 `check_final()` 자동 실행.
모든 함수는 (통과여부, 위반항목리스트) 튜플 반환.

## 분량 티어 설정 (★ v10 패치 6 ★)

```python
DURATION_TIERS = {
    'normal': {   # 1시간, 1.5시간
        'chapter_tolerance': 0.25,
        'chapter_floor': 3500,
        'final_tolerance': 0.15,
        'final_floor_ratio': 0.85,   # target × 0.85
        'beat_tolerance': 0.20,      # 비트별 ±20%
        'big_beat_tolerance': 0.20,  # ⑧⑩⑭ ±20%
    },
    'strict': {   # 2시간
        'chapter_tolerance': 0.15,
        'chapter_floor': 4410,
        'final_tolerance': 0.10,
        'final_floor_ratio': 0.90,   # target × 0.90 = 41,400 ≈ 41,500
        'beat_tolerance': 0.20,      # 비트별 ±20%
        'big_beat_tolerance': 0.15,  # ⑧⑩⑭ ±15% (strict)
    },
}

def get_tier(total_chapters):
    """챕터 수로 티어 자동 판별. 9챕터 = strict."""
    return 'strict' if total_chapters >= 9 else 'normal'
```

## 공통 유틸리티

```python
import re
from collections import Counter

def split_lines(text):
    """라인 분할, 빈 줄 제거"""
    return [l.strip() for l in text.split('\n') if l.strip()]

def is_dialogue(line):
    """따옴표로 시작하는 라인 = 대사"""
    return line.startswith('"') or line.startswith('\u201c')

def split_sentences(text):
    """한국어 문장 분할 (마침표·물음표·느낌표 + 줄바꿈)"""
    sentences = re.split(r'(?<=[.!?])\s+|\n+', text)
    return [s.strip() for s in sentences if s.strip()]

def get_narration_only(text):
    """대사 제외한 나레이션 텍스트"""
    lines = split_lines(text)
    return [l for l in lines if not is_dialogue(l)]

def char_count(text):
    """순수 글자수 (Python len, 공백 포함)"""
    return len(text)
```

## 정규식 검증 21개

### 1. 한자/한문 검사

```python
def check_hanja(text):
    pattern = r'[\u4e00-\u9fff]'
    matches = re.findall(pattern, text)
    return (len(matches) == 0, matches)
```

### 2. 메타 정보 자동 제거

```python
def remove_meta(text):
    """장 번호·구분선·이모지 자동 제거 후 텍스트 반환"""
    patterns = [
        r'^\[.*?\]\s*\w*$',
        r'^【.*?】\s*\w*$',
        r'^챕터\s*\d+.*$',
        r'^제\s*\d+\s*장.*$',
        r'^\d+\s*장\s+.*$',
        r'^---+$',
        r'^\*\*\*+$',
        r'^===+$',
    ]
    cleaned = []
    for line in text.split('\n'):
        if not any(re.match(p, line.strip()) for p in patterns):
            cleaned.append(line)
    cleaned_text = '\n'.join(cleaned)
    cleaned_text = re.sub(r'[\U0001F300-\U0001FAFF\U00002600-\U000027BF]', '', cleaned_text)
    return cleaned_text

def check_meta(text):
    cleaned = remove_meta(text)
    return (text == cleaned, ['메타 정보 발견 — 자동 제거 권장'] if text != cleaned else [])
```

### 3. 비하 호칭 카운트 (누적 max 2회)

```python
def check_derogatory(text, prev_count=0):
    # 욕설 '년'만 매칭. 숫자·연도의 '년(年)'은 제외.
    insult_pattern = r'(?:이|저|그|계집|같은|미친|어린|독한)\s*년(?![가-힣])'
    matches = re.findall(insult_pattern, text)
    total = prev_count + len(matches)
    return (total <= 2, [f'비하 호칭 {total}회 (이번 챕터 {len(matches)}회)'] if total > 2 else [])
```

### 4. ~습니다 3연속 (나레이션만)

```python
def check_seumnida_3(text):
    narration = get_narration_only(text)
    consecutive = 0
    violations = []
    for i, line in enumerate(narration):
        sentences = split_sentences(line)
        for s in sentences:
            if re.search(r'습니다\.?$', s):
                consecutive += 1
                if consecutive >= 3:
                    violations.append(f'L{i}: {s[:30]}...')
            else:
                consecutive = 0
    return (len(violations) == 0, violations)
```

### 5. 어미 인접 반복 일반화

```python
def check_ending_repeat(text):
    narration = get_narration_only(text)
    endings = ['지요', '어요', '을까요', '군요', '네요', '습니다']
    violations = []
    
    sentence_endings = []
    for line in narration:
        for s in split_sentences(line):
            for end in endings:
                if re.search(end + r'\.?$', s):
                    sentence_endings.append((s, end))
                    break
            else:
                sentence_endings.append((s, 'other'))
    
    consecutive = 1
    for i in range(1, len(sentence_endings)):
        if sentence_endings[i][1] == sentence_endings[i-1][1] and sentence_endings[i][1] != 'other':
            consecutive += 1
            if consecutive >= 3:
                violations.append(f'어미 "{sentence_endings[i][1]}" 3연속: {sentence_endings[i][0][:30]}...')
        else:
            consecutive = 1
    return (len(violations) == 0, violations)
```

### 6. 한 문장 동일 단어 2회

```python
def check_dup_word_in_sentence(text):
    # 대사 제외. 대구·후렴·주제 대사의 의도된 반복 오탐 차단.
    narration = get_narration_only(text)
    stop = {'있는', '없는', '하는', '되는', '같은', '그리고', '그러나', '하지만'}
    violations = []
    for line in narration:
        for s in split_sentences(line):
            words = re.findall(r'[가-힣]{2,}', s)
            dupes = [w for w, c in Counter(words).items() if c >= 2 and w not in stop]
            if dupes:
                violations.append(f'"{s[:40]}..." → {dupes}')
    return (len(violations) == 0, violations[:5])
```

### 7. 인접 동일 대사 (2회+)

```python
def check_adjacent_same_dialogue(text):
    dialogues = re.findall(r'\u201c([^\u201d]+)\u201d', text)
    violations = []
    for i in range(1, len(dialogues)):
        if dialogues[i] == dialogues[i-1]:
            violations.append(f'인접 동일 대사: \u201c{dialogues[i][:30]}...\u201d')
    return (len(violations) == 0, violations)
```

### 8. 한 문단 동의어 반복

```python
def check_paragraph_word_repeat(text):
    paragraphs = text.split('\n\n')
    violations = []
    for p in paragraphs:
        words = re.findall(r'[가-힣]{2,}', p)
        counter = Counter(words)
        repeats = [(w, c) for w, c in counter.items() if c >= 3 and w not in {'그러나', '그런데', '하지만'}]
        for w, c in repeats:
            violations.append(f'"{w}" {c}회: {p[:40]}...')
    return (len(violations) == 0, violations[:5])
```

### 9. 이중 접속사

```python
def check_double_conjunction(text):
    sentences = split_sentences(text)
    patterns = [
        (r'그렇다면.*면\b', '이중 조건절'),
        (r'그리고.*그리고', '그리고 반복'),
        (r'그래서.*그래서', '그래서 반복'),
        (r'하지만.*하지만', '하지만 반복'),
    ]
    violations = []
    for s in sentences:
        for p, name in patterns:
            if re.search(p, s):
                violations.append(f'{name}: {s[:40]}...')
    return (len(violations) == 0, violations)
```

### 10. 시간 표시 누적

```python
def check_time_redundancy(text):
    time_groups = [
        ['삼 년', '3년', '봄이 세 번', '세 해'],
        ['일 년', '1년', '한 해'],
        ['하루', '한 날'],
    ]
    violations = []
    for group in time_groups:
        positions = []
        for term in group:
            for m in re.finditer(re.escape(term), text):
                positions.append((m.start(), term))
        positions.sort()
        for i in range(1, len(positions)):
            if positions[i][0] - positions[i-1][0] < 200:
                violations.append(f'시간 표현 누적: "{positions[i-1][1]}" + "{positions[i][1]}"')
    return (len(violations) == 0, violations)
```

### 11. 대사 비중

```python
def check_dialogue_ratio(text):
    dialogues = re.findall(r'\u201c[^\u201d]+\u201d', text)
    dialogue_chars = sum(len(d) for d in dialogues)
    total_chars = len(text)
    ratio = dialogue_chars / total_chars if total_chars > 0 else 0
    return (ratio >= 0.35, [f'대사 비중 {ratio*100:.1f}% (목표 40%, 최소 35%)']) if ratio < 0.35 else (True, [])
```

### 12. 나레이션 500자 연속 초과

```python
def check_narration_500(text):
    blocks = re.split(r'\u201c[^\u201d]+\u201d', text)
    max_block = max((len(b.strip()) for b in blocks), default=0)
    return (max_block <= 500, [f'나레이션 연속 {max_block}자 (최대 500)'] if max_block > 500 else [])
```

### 13. 수사 질문 빈도

```python
def check_rhetorical_questions(text):
    narration = get_narration_only(text)
    total_sentences = sum(len(split_sentences(line)) for line in narration)
    questions = sum(1 for line in narration for s in split_sentences(line) if s.endswith('?') or s.endswith('까요.') or s.endswith('니까.'))
    expected = total_sentences / 10
    return (questions >= expected * 0.5, [f'수사 질문 {questions}회 / 기대 {expected:.0f}회'] if questions < expected * 0.5 else [])
```

### 14. 인물 나이 표기 vs 팩트시트

```python
def check_age_vs_facts(text, facts_dict):
    violations = []
    for name, expected_age in facts_dict.items():
        pattern = re.escape(name) + r'.{0,20}?(\d+|[가-힣]+)\s*[세살]'
        for m in re.finditer(pattern, text):
            mentioned = m.group(1)
            korean_nums = {'스물': 20, '서른': 30, '마흔': 40, '쉰': 50, '예순': 60}
            num = korean_nums.get(mentioned[:2], None)
            if num is None:
                try:
                    num = int(mentioned)
                except:
                    continue
            if num != expected_age:
                violations.append(f'{name}: 본문 {num}세 vs 팩트시트 {expected_age}세')
    return (len(violations) == 0, violations)
```

### 15. 인물 나이 산수 모순

```python
def check_age_arithmetic(parents_children):
    violations = []
    for p_name, p_age, c_name, c_age in parents_children:
        diff = p_age - c_age
        if diff < 13:
            violations.append(f'{p_name}({p_age}세) → {c_name}({c_age}세): 나이차 {diff}세 (최소 13)')
        if diff < 0:
            violations.append(f'{p_name}({p_age}세) → {c_name}({c_age}세): 음수')
    return (len(violations) == 0, violations)
```

### 16~17. 호칭·장소 (placeholder)

```python
def check_honorifics(text, honorific_dict):
    return (True, [])

def check_locations(text, location_set):
    return (True, [])
```

### 18. 따옴표 짝 일치

```python
def check_quote_pairs(text):
    smart_open = text.count('\u201c')
    smart_close = text.count('\u201d')
    if smart_open != smart_close:
        return (False, [f'스마트 따옴표 불일치: {smart_open} vs {smart_close}'])
    open_count = text.count('"')
    if open_count % 2 != 0:
        return (False, [f'일반 따옴표 홀수: {open_count}'])
    return (True, [])
```

### 19. 한자어 비율 (placeholder)

```python
def check_hanja_word_ratio(text):
    return (True, [])
```

### 20. 25자 이상 긴 문장

```python
def check_long_sentences(text):
    sentences = split_sentences(text)
    long_count = sum(1 for s in sentences if len(s) > 25)
    ratio = long_count / len(sentences) if sentences else 0
    return (ratio <= 0.10, [f'25자 초과 문장 {long_count}/{len(sentences)} ({ratio*100:.1f}%)']) if ratio > 0.10 else (True, [])
```

### 21. 글자수

```python
def check_char_count(text, target):
    actual = len(text)
    low = target * 0.8
    high = target * 1.2
    return (low <= actual <= high, [f'글자수 {actual} (목표 {target} ±20% = {int(low)}~{int(high)})'])
```

## 티어별 글자수 검증 함수 (★ 패치 6 ★)

```python
def check_char_count_by_tier(text, target, tier='normal'):
    """챕터 글자수 — 티어별 임계 + 절대 바닥."""
    config = DURATION_TIERS[tier]
    actual = len(text)
    tol = config['chapter_tolerance']
    floor = config['chapter_floor']
    low = target * (1 - tol)
    high = target * (1 + tol)
    
    # 절대 바닥 미달 = 즉시 실패 (tolerance 무관)
    if actual < floor:
        return (False, [f'글자수 {actual} — 절대 바닥 {floor}자 미달 (tier={tier})'])
    
    passed = low <= actual <= high
    if not passed:
        return (False, [f'글자수 {actual} (목표 {target} ±{int(tol*100)}% = {int(low)}~{int(high)}, 바닥 {floor}, tier={tier})'])
    return (True, [])

def check_final_char_count_by_tier(text, target, tier='normal'):
    """합본 글자수 — 티어별 임계 + 절대 바닥."""
    config = DURATION_TIERS[tier]
    actual = len(text)
    tol = config['final_tolerance']
    floor = int(target * config['final_floor_ratio'])
    low = target * (1 - tol)
    high = target * (1 + tol)
    
    if actual < floor:
        return (False, [f'합본 글자수 {actual} — 절대 바닥 {floor}자 미달 (tier={tier})'])
    
    passed = low <= actual <= high
    if not passed:
        return (False, [f'합본 글자수 {actual} (목표 {target} ±{int(tol*100)}% = {int(low)}~{int(high)}, 바닥 {floor}, tier={tier})'])
    return (True, [])
```

## 누적 페이스 추적 (★ 패치 6 — strict 티어 전용 ★)

```python
def check_pace(completed_chars, completed_chapters, total_target, total_chapters):
    """strict 티어: 누적 글자수가 예상 페이스 대비 -5% 이하면 경고."""
    expected = total_target * (completed_chapters / total_chapters)
    gap_pct = (completed_chars - expected) / expected * 100 if expected > 0 else 0
    
    if gap_pct < -5:
        remaining_chapters = total_chapters - completed_chapters
        needed_total = total_target - completed_chars
        needed_per_chapter = needed_total / remaining_chapters if remaining_chapters > 0 else 0
        return (False, [
            f'누적 {completed_chars}자, 예상 페이스 {int(expected)}자 대비 {gap_pct:.1f}%',
            f'남은 {remaining_chapters}챕터에서 챕터당 평균 {int(needed_per_chapter)}자 필요'
        ])
    return (True, [f'페이스 OK: {completed_chars}자 / 예상 {int(expected)}자 ({gap_pct:+.1f}%)'])
```

## 비트별 분량 검증 (★ 패치 6 — strict 강화 ★)

```python
BEAT_RATIOS_2HR = {
    'intro': 0.01,
    '①': 0.03, '②': 0.04, '③': 0.11, '④': 0.04,
    '⑤': 0.08, '⑥': 0.03, '⑦': 0.06, '⑧': 0.18,
    '⑨': 0.04, '⑩': 0.12, '⑪': 0.03, '⑫': 0.04,
    '⑬': 0.02, '⑭': 0.13, '⑮': 0.02, 'ending': 0.02,
}

BIG_BEATS = {'⑧', '⑩', '⑭'}  # strict에서 ±15% 적용

def check_beat_proportions(beat_chars_dict, total_target, tier='normal'):
    """비트별 분량 검증. beat_chars_dict = {'⑧': 7500, '⑩': 4800, ...}"""
    config = DURATION_TIERS[tier]
    violations = []
    
    for beat, actual_chars in beat_chars_dict.items():
        if beat not in BEAT_RATIOS_2HR:
            continue
        expected = total_target * BEAT_RATIOS_2HR[beat]
        tol = config['big_beat_tolerance'] if beat in BIG_BEATS else config['beat_tolerance']
        low = expected * (1 - tol)
        high = expected * (1 + tol)
        
        if actual_chars < low:
            violations.append(f'{beat}: {actual_chars}자 (목표 {int(expected)}자, 하한 {int(low)}자, -{(1 - actual_chars/expected)*100:.0f}%)')
        elif actual_chars > high:
            violations.append(f'{beat}: {actual_chars}자 (목표 {int(expected)}자, 상한 {int(high)}자, +{(actual_chars/expected - 1)*100:.0f}%)')
    
    return (len(violations) == 0, violations)
```

## Opus 모드 메인 함수 (★ v10 패치 6 — 티어 통합 ★)

### check_chapter_lite — 챕터 단위 (치명적 5개 + 티어별 글자수)

```python
def check_chapter_lite(text, target, tier='normal', facts_dict=None):
    """매 챕터 작성 후 호출. 치명적 결함 + 티어별 글자수 검증.
    문체·TTS 검증은 합본 후 check_final로 미룸."""
    results = []
    
    checks = [
        ('한자', check_hanja(text)),
        ('메타 정보', check_meta(text)),
        ('따옴표 짝', check_quote_pairs(text)),
        ('인접 동일 대사', check_adjacent_same_dialogue(text)),
        ('글자수', check_char_count_by_tier(text, target, tier)),  # ★ 티어별
    ]
    
    if facts_dict:
        checks.append(('나이 표기', check_age_vs_facts(text, facts_dict)))
    
    all_passed = True
    for name, (passed, violations) in checks:
        if not passed:
            all_passed = False
            results.append((name, violations))
    
    return all_passed, results
```

### check_final — 합본 후 일괄 (★ 티어별 기준 적용 ★)

```python
def check_final(merged_text, target, facts_dict, parents_children, tier='normal', beat_chars=None):
    """합본 후 최종 검증. 티어에 따라 글자수·비트 기준 달라짐."""
    results = []
    
    # 1. 사실·구조 검증
    structural = [
        ('한자', check_hanja(merged_text)),
        ('메타 정보', check_meta(merged_text)),
        ('따옴표 짝', check_quote_pairs(merged_text)),
        ('인접 동일 대사', check_adjacent_same_dialogue(merged_text)),
        ('글자수', check_final_char_count_by_tier(merged_text, target, tier)),  # ★ 티어별
    ]
    
    # 2. 문체 검증 (합본 기준)
    style = [
        ('대사 비중', check_dialogue_ratio_with_threshold(merged_text, 0.35)),
        ('25자 초과 비율', check_long_sentences_loose(merged_text, 0.20)),
        ('~습니다 3연속', check_count_threshold(check_seumnida_3, merged_text, 5)),
        ('어미 인접 반복', check_count_threshold(check_ending_repeat, merged_text, 5)),
        ('한 문장 동일 단어', check_count_threshold(check_dup_word_in_sentence, merged_text, 5)),
        ('문단 단어 반복', check_count_threshold(check_paragraph_word_repeat, merged_text, 5)),
        ('나레이션 연속', check_count_threshold(check_narration_500, merged_text, 3)),
        ('이중 접속사', check_count_threshold(check_double_conjunction, merged_text, 3)),
        ('시간 표현 누적', check_count_threshold(check_time_redundancy, merged_text, 3)),
        ('비하 호칭 누적', check_derogatory(merged_text, 0)),
    ]
    
    # 3. 산수·정합성
    age_check = check_age_arithmetic(parents_children)
    
    # 4. 비트별 분량 (★ strict 강화 ★)
    if beat_chars:
        beat_check = check_beat_proportions(beat_chars, target, tier)
        if not beat_check[0]:
            results.append(('비트별 분량', beat_check[1]))
    
    # 5. 고정 마무리 멘트
    fixed_ending = "다음 영상을 빠르게 만나보시려면 좋아요와 구독을 눌러주세요."
    
    all_checks = structural + style
    for name, (passed, violations) in all_checks:
        if not passed:
            results.append((name, violations))
    
    if not age_check[0]:
        results.append(('나이 산수', age_check[1]))
    
    if fixed_ending not in merged_text:
        results.append(('고정 멘트', ['마무리 고정 멘트 누락']))
    
    return len(results) == 0, results

def check_dialogue_ratio_with_threshold(text, threshold):
    dialogues = re.findall(r'\u201c[^\u201d]+\u201d', text)
    dialogue_chars = sum(len(d) for d in dialogues)
    total_chars = len(text)
    ratio = dialogue_chars / total_chars if total_chars > 0 else 0
    passed = ratio >= threshold
    return (passed, [f'대사 비중 {ratio*100:.1f}% (최소 {threshold*100:.0f}%)'] if not passed else [])

def check_long_sentences_loose(text, threshold=0.20):
    sentences = split_sentences(text)
    long_count = sum(1 for s in sentences if len(s) > 25)
    ratio = long_count / len(sentences) if sentences else 0
    passed = ratio <= threshold
    return (passed, [f'25자 초과 {long_count}/{len(sentences)} ({ratio*100:.1f}%, 임계 {threshold*100:.0f}%)'] if not passed else [])

def check_count_threshold(check_fn, text, max_count):
    passed_inner, violations = check_fn(text)
    if passed_inner:
        return (True, [])
    count = len(violations)
    if count <= max_count:
        return (True, [])
    return (False, [f'위반 {count}건 (임계 {max_count}건 이하)'] + violations[:3])

def check_narration_with_threshold(text, max_chars):
    blocks = re.split(r'\u201c[^\u201d]+\u201d', text)
    max_block = max((len(b.strip()) for b in blocks), default=0)
    passed = max_block <= max_chars
    return (passed, [f'나레이션 연속 {max_block}자 (이 챕터 최대 {max_chars})'] if not passed else [])
```

### 위반 라인 추출 헬퍼

```python
def find_violation_lines(text, check_fn):
    lines = text.split('\n')
    passed, violations = check_fn(text)
    if passed:
        return []
    
    located = []
    for v in violations:
        match = re.search(r'[:""]([^"]{10,40})', v)
        if match:
            snippet = match.group(1)[:30]
            for i, line in enumerate(lines, 1):
                if snippet in line:
                    located.append((i, line.strip()[:60], v))
                    break
    return located
```

## 사용 예 (★ 티어 반영 ★)

```python
# 매 챕터 후 — 2시간 strict 모드
text = open('/home/claude/v10/chapter_3.txt').read()
facts = {'서하': 20, '도원': 25, '엄대감': 58, '임수복': 35}
tier = 'strict'  # progress.md에서 읽음
passed, violations = check_chapter_lite(text, 5000, tier, facts)

if not passed:
    print("❌ 위반 사항 (치명적):")
    for name, v in violations:
        print(f"  [{name}] {v}")
else:
    print("✅ 챕터 3 통과 (lite, tier=strict)")

# strict 페이스 추적
cumulative = 15460  # 챕터 1~3 누적
pace_ok, pace_msg = check_pace(cumulative, 3, 46000, 9)
print(pace_msg)

# 합본 후 — 티어별 검증
merged = open('/home/claude/v10/final.txt').read()
parents = [('엄대감', 58, '도원', 25)]
beat_chars = {'⑧': 7800, '⑩': 5200, '⑭': 5600}  # 비트별 글자수
final_passed, final_violations = check_final(merged, 46000, facts, parents, tier, beat_chars)

if not final_passed:
    print(f"합본 위반 {len(final_violations)}건:")
    for name, v in final_violations:
        print(f"  [{name}] {v}")
```

## 주의

- 정규식은 한국어 특성상 false positive 가능. 첫 1~2 작업에서 미세 조정.
- Opus 모드 핵심: 챕터 단위 = 치명적 5개만. 문체는 합본 일괄. **무한 수정 루프 금지.**
- ★ 2시간 strict 티어: 글자수 검증만 엄격 (±15% + 바닥 4,500). 문체 검증은 normal과 동일 (합본 일괄).
- `check_age_vs_facts`, `check_locations`, `check_honorifics`는 팩트시트 형식에 맞춰 입력값 조정.
