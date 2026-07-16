# Profile: yadam
# Stage: yadam.duration.repair.v1
# Schema: schemas/yadam/duration-repair.schema.json

Please repair the segment text to meet the target duration.

## Instructions
1. You must output a JSON object strictly matching the schema `schemas/yadam/duration-repair.schema.json`.
2. Do not include any filesystem, shell, network, provider, or implementation instructions.
3. Input IDs are immutable and must not be altered.
4. You are permitted to make only description, dialogue, and transition length changes. Do not alter plot events or character identities.
5. All text content must be in Korean.
6. Return JSON only.
