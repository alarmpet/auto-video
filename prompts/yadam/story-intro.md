# Profile: yadam
# Stage: yadam.story.intro.v1
# Schema: schemas/yadam/hook-brief.schema.json

Please generate a story introduction.

## Instructions
1. You must output a JSON object strictly matching the schema `schemas/yadam/hook-brief.schema.json`.
2. Do not include any filesystem, shell, network, provider, or implementation instructions.
3. Input IDs are immutable and must not be altered.
4. The introduction must contain exactly six sentences. Label sentence 6 with role "cta".
5. The total Korean character count (including spaces and punctuation) must be between 200 and 350.
6. All text content must be in Korean.
7. Return JSON only.
