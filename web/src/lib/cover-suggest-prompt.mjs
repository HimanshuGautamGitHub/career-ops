/**
 * cover-suggest-prompt.mjs — build the read-only "Suggest with AI" instruction
 * for the cover-letter draft surface (AGEN-265).
 *
 * The report page asks the candidate four Step 6 prompts before it can run the
 * real cover mode (why this role, what problem, what approach, what tone — see
 * cover-brief.mjs and run-prompts.mjs's `cover` kind). Typing all four from a
 * blank field is the friction the ticket names. This builds a prompt that lets
 * the user's own CLI DRAFT those four answers from what career-ops already
 * knows about them, so the fields arrive pre-filled and editable. Nothing is
 * sent: the suggestion lands in the editable brief, the user reviews and edits,
 * and only then does the existing `cover` run draft the letter.
 *
 * Plain .mjs whose only imports are the dependency-free profile-path.mjs and
 * cover-tones.mjs, exactly like answer-prompt.mjs: the prompt is the part of
 * the suggest route that decides what the model may read, and it must be
 * loadable by `node --test` to be pinned. tests/cover-suggest-prompt.test.mjs
 * pins the Source-of-Truth Boundary it encodes.
 *
 * SOURCE-OF-TRUTH BOUNDARY (AGENTS.md, hard constraint). The user wrote "if
 * user's Claude is used then use context about user to fill this." That
 * "context" is the in-scope user-layer files ONLY. This path draws from cv.md,
 * config/profile.yml, article-digest.md, modes/_profile.md and writing-samples/
 * plus the evaluation report, and it is forbidden from reading Claude's
 * auto-memory, any cross-session / cross-project context, or any file outside
 * the career-ops project. That is why — unlike apply/prefill and explore/ai —
 * this builder has NO memory parameter and never imports the auto-memory
 * reader: there is no channel through which out-of-scope context could reach
 * the prompt.
 */
import { DEFAULT_PROFILE_REF, profileNote } from "./core/profile-path.mjs";
import { COVER_TONES } from "./cover-tones.mjs";

/**
 * @param {{
 *   input: string,
 *   reportFile: string,
 *   company?: string,
 *   role?: string,
 *   profile?: string,
 * }} opts
 * `input` is the report/application number. `reportFile` is the root-relative
 * path to the evaluation report. `profile` is how the prompt names the profile
 * file: profileRef() in core/profile-path.mjs. There is deliberately NO memory
 * parameter — see the boundary note above.
 * @returns {string}
 */
export function buildCoverSuggestPrompt({ input, reportFile, company, role, profile = DEFAULT_PROFILE_REF }) {
  const profileLine = profileNote(profile);
  const target = [company, role].filter(Boolean).join(" — ");
  const toneKeys = Object.keys(COVER_TONES);
  const toneList = toneKeys.map((k) => `"${k}" (${COVER_TONES[k]})`).join(", ");

  return `${profileLine}You are suggesting a FIRST DRAFT of the four cover-letter planning answers for application #${input}${target ? ` (${target})` : ""}, headless. The candidate will review and edit every answer before any letter is written — your output is a starting point, never a finished letter and never sent anywhere.

SOURCES — read ONLY these, nothing else:
- cv.md — the candidate's résumé and the ground truth for facts.
- ${profile} — identity, targeting and preferences.
- article-digest.md — proof points, if present.
- modes/_profile.md — the candidate's archetypes and narrative, if present.
- writing-samples/ — the candidate's own voice, if present.
- The evaluation report for this posting at ${JSON.stringify(reportFile)} — the role, company and fit analysis.

BOUNDARY — this is mandatory and not negotiable:
- Draw the "context about the user" ONLY from the in-scope files above.
- Do NOT read Claude's auto-memory (e.g. ~/.claude/.../memory), and never treat anything in it as a source.
- Do NOT read any cross-session or cross-project context, any other career-ops install, or any file outside the career-ops project — everything outside the list above is out-of-scope.
- Never invent facts, metrics, employers, or projects. If the in-scope files do not support a point, leave that answer shorter rather than fabricate. Keywords get reformulated, never fabricated.

Produce a suggested answer for each of the four planning prompts, in the candidate's own voice, grounded in the sources:
- why: why this role / company is a fit — one or two concrete angles (scale, mission, stage, domain) drawn from the report and the candidate's real background.
- problem: a specific problem the candidate could solve for them, tied to what the posting and report say the company needs.
- approach: how the candidate would approach it, concrete and specific, in one or two sentences.
- tone: the single best-fit tone key for this candidate and posting. It MUST be exactly one of: ${toneList}.

Keep why, problem and approach under ~100 words each, honest, concrete, active voice, real metrics only.

Output ONLY a compact JSON object: {"why": "...", "problem": "...", "approach": "...", "tone": "<one tone key>"}. No prose, no markdown, no code fence.`;
}
