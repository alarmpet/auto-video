# Visual Semantic QA Options

## Immediate Required Gate

Use `storyboard-context-alignment-report.json` before rendering.

- Pros: fast, deterministic, no GPU vision model required.
- Cons: verifies prompt text, not the generated image.

## Optional Image-Text Gate

Use CLIPScore after keyframes are generated.

- Input: generated `keyframes/scene_XX.png` and compiled prompt/context card.
- Pass: image-text score above a local baseline threshold.
- Caveat: CLIPScore is useful for broad image-text compatibility but can miss subtle biblical or psychological details.
- Reference: https://arxiv.org/abs/2104.08718

## Optional Caption-Backcheck

Use BLIP or BLIP-2 to caption generated keyframes, then compare the generated caption with the original context card.

- Input: generated image.
- Output: caption text.
- Compare caption with `contextCard.visualAnchor`, `psychologyConcept`, and `biblicalCharacters`.
- Reference: https://arxiv.org/abs/2201.12086

## Optional Text-Text Similarity Gate

Use Sentence Transformers or local embeddings for:

`narration -> context card -> prompt`

- Compare narration and prompt as text.
- Use this before ComfyUI to reject generic prompts.
- Reference: https://sbert.net/docs/sentence_transformer/usage/semantic_textual_similarity.html
