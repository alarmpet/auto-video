# Profile: yadam
# Stage: yadam.scene.plan.v1
# Schema: schemas/yadam/scene-plan.schema.json

Please generate visual scene planning slots.

## Instructions
1. You must output a JSON object strictly matching the schema `schemas/yadam/scene-plan.schema.json`.
2. Do not include any filesystem, shell, network, provider, or implementation instructions.
3. Input IDs are immutable and must not be altered.
4. Ground each slot's prompt directly in the source scenes. To represent a long still, extend the slot.
5. All text content must be in Korean.
6. Return JSON only.
