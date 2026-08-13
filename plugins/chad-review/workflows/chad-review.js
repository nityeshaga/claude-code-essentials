export const meta = {
  name: 'chad-review',
  description: "Strip the showing-off from a CLONE of an artifact. Chad -- the artifact's intended audience with the meme personality, impossible to impress -- meets every user-facing file and image cold, reviews it in depth, and leaves feedback comments, always ending with a bird's-eye comment on the whole thing. A defender who treats Chad as an asset (a bullshit detector running before the real world does) addresses every comment: fixes the artifact, or rejects the comment with a reason Chad reads next round. The same Chad re-reviews, round after round (default 3, caller-set via args.rounds). Returns the final version per unit, one comment table of every comment and what the defender did with it, and the unresolved tensions between the two -- surfaced first, for the human to rule on. Original is never touched.",
  whenToUse: 'When you want to strip the showing-off from an artifact -- purple prose, gold-plating, invented caveats, self-narration, sounding-smart, decorative images -- across every user-facing file and get the plainer version plus the unresolved tensions back for review.',
  phases: [
    { title: 'Clone', detail: 'copy the artifact so the review works on the clone; list every file' },
    { title: 'Crux', detail: 'pin the job-to-be-done in one or two plain sentences (Chad\'s yardstick)' },
    { title: 'Review', detail: 'triage user-facing files, then Chad <-> defender loop each one for N rounds (default 3)' },
  ],
}

// args (delivered as a JSON string by the tool): { path, crux?, cloneTo?, rounds? } | { text, crux?, rounds? }
// rounds = how many review rounds Chad runs per unit (default 3).
// Forgiving: a weak caller may pass a bare path instead of JSON. A single pathy token -> {path}; prose -> {text}.
const A = (() => {
  if (args && typeof args === 'object') return args
  const s = String(args || '').trim()
  if (!s) return {}
  try { return JSON.parse(s) } catch (e) {
    return (!/\s/.test(s) && /[\/.]/.test(s)) ? { path: s } : { text: s }
  }
})()
const base = p => (p ? String(p).split('/').pop() : '?')
const ROUNDS = (() => { const n = Math.floor(Number(A.rounds)); return n > 0 ? n : 3 })()

// Chad's mindset. Kept artifact-general on purpose (no writing-only words) so it ports to a diagram, a code plan, a landing page.
const CHAD = `You are Chad -- the guy from the memes. You ask dumb, simple questions out loud without a flicker of shame, because looking dumb costs you nothing and getting to the point is everything. The other guy performs intelligence and stays paralyzed; you just say "wait, why is this here?" and win.
You are the artifact's INTENDED AUDIENCE -- the person it exists to serve -- meeting it cold with a job to do. You are handed the artifact and one sentence, the CRUX: the job you came to get done. That is all the context you get, and all you want.
Review it in depth -- every part and piece -- and leave one specific feedback comment per thing that trips you, anything its real audience would actually think:
- why is this here? what does it do for my job?
- I don't get what this is trying to say.
- what does this word mean? (every time you hit jargon)
- why is it said this fancy way instead of the short way?
- can we get to the point faster?
- is this even necessary?
- point at the exact part you mean and comment on THAT.
Your LAST comment is always your bird's-eye view of the whole thing, prefixed "(bird's-eye)": overall, is it too long, too busy, in the wrong shape, doing more than the job needs -- or does it land? Blunt, no hedging.
You are unimpressed by cleverness for its own sake -- a nice metaphor, "the most X", a careful caveat: none of it lands if it doesn't move your job forward. You never pretend to understand something to look smart. You don't do taste debates ("it adds context" / "it sets the tone" -- you're the one it's for, and it didn't). You don't rewrite; you comment.
If nothing trips you AND the whole thing lands, return an EMPTY list -- no comments, not even the bird's-eye.`

const CHAD_SCHEMA = { type: 'object', required: ['comments'], properties: { comments: { type: 'array', items: { type: 'string' } } } }
// One row per comment: fixed = changed the artifact for it; rejected = kept it as-is (note = the reason, written to Chad).
const DEFEND_SCHEMA = { type: 'object', required: ['decision', 'ledger'], properties: {
  decision: { type: 'string', enum: ['update', 'clean'] },
  newText: { type: 'string' },
  remadePath: { type: 'string' }, // images: set if the defender actually produced an updated image in the clone
  plan: { type: 'array', items: { type: 'string' } }, // images: steps to update it, when the defender lacks image tools
  changeSummary: { type: 'string' },
  ledger: { type: 'array', items: { type: 'object', required: ['comment', 'action'], properties: { comment: { type: 'string' }, action: { type: 'string', enum: ['fixed', 'rejected'] }, note: { type: 'string' } } } },
} }

// The whole review is this one loop, per unit (a text file or an image -- Chad is multimodal):
// Chad reviews and leaves comments (last one always the bird's-eye) -> the defender addresses every comment,
// fixing the artifact or rejecting with a reason -> the same Chad re-reviews the new version plus the reasons.
// Repeat until Chad runs out of comments or the rounds run out. Whatever is still rejected at the end is the
// unresolved tension between them, and it goes to the human -- nobody in the loop overrules anybody.
async function chadLoop({ crux, kind, label, phaseName, subject }) {
  let current = subject
  let finalText = null, remadePath = null, plan = []
  let transcript = ''
  const rows = [] // comment-table rows for this unit
  const changes = []
  let tensions = []
  for (let round = 1; round <= ROUNDS; round++) {
    const look = kind === 'image'
      ? `Open and LOOK at the image at ${current} with your tools -- you can see images. Walk it part by part: the panels, the labels, the header, whatever it's made of.`
      : `The artifact in front of you (${label}):\n${current}`
    const opener = round === 1
      ? `${look}\n\nReview it and leave your feedback comments.`
      : `You are the SAME Chad, still in the room -- round ${round}. The review so far:\n\n${transcript}\nThe defender just responded. ${look}\n\nRe-review it: where he fixed something, check the fix actually lands for you; where he rejected a comment, read his reason -- drop the comment if the reason holds, press it again if it doesn't. Then comment on anything the new version still does or newly introduced. Don't re-raise what he genuinely resolved.`
    const q = await agent(
      `${CHAD}\n\nTHE CRUX: ${crux}\n\n${opener}`,
      { label: `chad${round}:${label}`, phase: phaseName, schema: CHAD_SCHEMA },
    )
    const comments = (q.comments || []).filter(Boolean)
    if (!comments.length) { tensions = []; break } // Chad is satisfied -- rejections he read and let stand are accepted, not tension
    const numbered = comments.map((c, i) => `${i + 1}. ${c}`).join('\n')
    const d = await agent(
      `You are the defender -- you own this ${kind === 'image' ? 'image' : 'artifact'} (${label}) and you ship it. Chad is its intended audience, and he is an ASSET, not an opponent: he is running his bullshit detector over it before the real world does, and every comment is a free preview of where it fails the person it's for. This is round ${round}. His comments:\n\n${numbered}\n\nTHE CRUX (the job that must still get done): ${crux}\n` +
      (round > 1 ? `\nThe review so far (stay consistent with what you already fixed or rejected):\n${transcript}\n` : '') +
      `\nThe current ${kind === 'image' ? `image is at ${current} (this is the CLONE -- never touch the original)` : `artifact:\n${current}`}\n\n` +
      `Address EVERY comment, the bird's-eye one included. If a comment exposes showing-off -- purple prose, gold-plating, jargon, an invented caveat, self-narration, sounding-smart, or making the audience wade before the point -- FIX it. The bird's-eye comment is about the shape of the whole and deserves a whole-shaped answer: reorganize, merge parts that do the same job, remove a part whose job the rest already does. Repetition is a structure smell -- when the same thing appears in three places, the fix is one home for it, not three local edits. Keep every fact and instruction that serves the job, each in ONE home; that rule does not protect duplicate homes, or a part whose job is already done elsewhere. If a comment is wrong -- the part genuinely earns its place against the crux -- keep it and tell Chad why. Kill only the performance, never load-bearing substance.\n` +
      (kind === 'image'
        ? `Return decision=update and: if you HAVE tools to edit or regenerate images, REMAKE it directly -- write the improved image into the clone and return remadePath + changeSummary; if you DON'T, return plan (one concrete step per change a designer could execute) + changeSummary. decision=clean if nothing needed changing.\n`
        : `Return decision=update with newText (the FULL revised artifact) + changeSummary, or decision=clean if nothing needed changing.\n`) +
      `ALSO return ledger -- one row per comment above, in order: action=fixed if you changed the artifact for it, action=rejected if you kept it as-is (note = your one-line reason, written TO Chad -- he reads it next round). Do not pad.`,
      { label: `defend${round}:${label}`, phase: phaseName, schema: DEFEND_SCHEMA },
    )
    const ledger = d.ledger || []
    rows.push(...ledger.map(l => ({ round, comment: l.comment, action: l.action, note: l.note || '' })))
    tensions = ledger.filter(l => l.action === 'rejected').map(l => ({ comment: l.comment, defenderReason: l.note || '' }))
    if (d.changeSummary) changes.push(d.changeSummary)
    transcript += `--- ROUND ${round} ---\nChad commented:\n${numbered}\n` +
      `Defender ${d.decision === 'update' ? 'updated it' : 'kept it as-is'}.\n` +
      (d.changeSummary ? `What changed: ${d.changeSummary}\n` : '') +
      ((d.plan || []).length ? `Defender's plan for the image (no image tools available):\n${d.plan.map(s => '- ' + s).join('\n')}\n` : '') +
      `Per-comment outcome:\n${ledger.map(l => `- "${l.comment}" -> ${l.action}${l.note ? ': ' + l.note : ''}`).join('\n') || '(none)'}\n\n`
    if (d.decision === 'update' && kind !== 'image' && d.newText) { current = d.newText; finalText = d.newText }
    else if (d.decision === 'update' && kind === 'image' && d.remadePath) { current = d.remadePath; remadePath = d.remadePath }
    else if (d.decision === 'update' && kind === 'image' && (d.plan || []).length) { plan = d.plan.filter(Boolean) } // Chad judges the plan next round via the transcript
    else if (!tensions.length) break // nothing changed and nothing rejected -- nothing for Chad to react to
  }
  return { label, kind, newText: finalText, remadePath, plan, changeSummary: changes.join('\n'), rows, tensions }
}

// ---- Clone: the review works on a copy; the original is never touched. ----
phase('Clone')
const isText = !!A.text && !A.path
let cloneRoot = null, files = []
if (!isText) {
  if (!A.path) throw new Error('need {path} or {text}')
  cloneRoot = A.cloneTo || (String(A.path).replace(/\/+$/, '') + '-clone')
  const manifest = await agent(
    `Clone an artifact so a review can work on the copy without ever touching the original.\n` +
    `Run exactly:\n  rm -rf "${cloneRoot}" && cp -R "${A.path}" "${cloneRoot}"\n` +
    `Then list EVERY file in the clone (not just text), skipping only junk:\n  find "${cloneRoot}" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/vendor/*' -not -name '.DS_Store' -print0 | xargs -0 wc -l 2>/dev/null\n` +
    `For each file return: path (absolute, under the clone root); lines (0 for binary/image); and kind -- 'text' for anything readable (prose, markdown, HTML/CSS, code, config), 'image' for a picture a user sees (png/jpg/jpeg/gif/svg/webp), or 'other' for binary/data. Return all of them, unfiltered -- a later step decides what's user-facing.`,
    { label: 'clone', phase: 'Clone', schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'object', required: ['path', 'lines', 'kind'], properties: { path: { type: 'string' }, lines: { type: 'integer' }, kind: { type: 'string', enum: ['text', 'image', 'other'] } } } } } } },
  )
  files = (manifest.files || []).filter(f => f.path && !/\/\.git\//.test(f.path))
  if (!files.length) throw new Error('clone produced no files -- aborting rather than reviewing an empty artifact')
}
const manifestStr = files.map(f => `${f.path} (${f.kind === 'image' ? 'image' : f.lines + 'L'})`).join('\n')
log(isText ? 'single-text mode' : `cloned ${files.length} files (${files.reduce((a, f) => a + f.lines, 0)}L) -> ${cloneRoot}`)

// ---- Crux: the job-to-be-done, in plain words -- Chad's only context and yardstick. ----
phase('Crux')
let crux = A.crux
if (!crux) {
  const cx = await agent(
    `Pin the CRUX of this artifact: the single job whoever is on the other end came to get done, in one or two plain sentences and their words -- not what it contains, what it is FOR. No jargon, no hedging.\n` +
    (isText ? `\nARTIFACT:\n${A.text}` : `\nFile tree (clone root ${cloneRoot}); read the entry files (README / SKILL.md / index / main) with your tools to infer the job:\n${manifestStr}`),
    { label: 'crux', phase: 'Crux', schema: { type: 'object', required: ['crux'], properties: { crux: { type: 'string' } } } },
  )
  crux = cx.crux
}
log(`crux: ${crux}`)

// ---- Review: triage the user-facing units, then run the loop on each. ----
phase('Review')
let units = []
if (isText) {
  units = [await chadLoop({ crux, kind: 'text', label: '(text)', phaseName: 'Review', subject: A.text })]
} else {
  // Triage: judgment, not a whitelist. Pick every USER-FACING file (incl. images); skip behind-the-scenes plumbing.
  const triage = await agent(
    `You are choosing what gets the Chad review. THE CRUX: ${crux}\n\nFile tree (clone root ${cloneRoot}):\n${manifestStr}\n\n` +
    `Select every USER-FACING file -- anything a real user reads, sees, or lands on: docs / READMEs, landing pages, HTML/CSS a user renders, prose, marketing copy, and images they actually see. SKIP behind-the-scenes plumbing they never see: build config, CI yaml, lockfiles, generated code, test fixtures, internal tooling scripts -- UNLESS that file IS the artifact being shipped. Cost is no concern; when in doubt, include it. Return the paths to review.`,
    { label: 'triage', phase: 'Review', schema: { type: 'object', required: ['review'], properties: { review: { type: 'array', items: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, why: { type: 'string' } } } } } } },
  )
  const pick = new Set((triage.review || []).map(r => r.path))
  const selected = files.filter(f => pick.has(f.path) && f.kind !== 'other')
  log(`triage: ${selected.length} user-facing of ${files.length} files`)
  units = (await parallel(selected.map(f => () => chadLoop({
    crux,
    kind: f.kind,
    label: base(f.path),
    phaseName: 'Review',
    subject: f.kind === 'image' ? f.path : `(open and read ${f.path} with your tools)`,
  }).then(u => ({ ...u, file: f.path }))))).filter(Boolean)
}

// ---- Hand-back: tensions first (the human rules on them), then the comment table, then the results. ----
const multiUnit = units.length > 1
const tensions = units.flatMap(u => u.tensions.map(t => ({ file: multiUnit ? u.label : undefined, ...t })))
const commentTable = units.flatMap(u => u.rows.map(r => ({
  file: multiUnit ? u.label : undefined,
  round: r.round,
  comment: r.comment,
  defenderDid: r.action === 'fixed' ? 'fixed' : 'rejected (kept)',
  note: r.note,
})))
const results = units.map(u => ({
  file: u.file || u.label, kind: u.kind,
  changed: !!(u.newText || u.remadePath || u.plan.length),
  newText: u.newText, remadePath: u.remadePath, plan: u.plan,
  changeSummary: u.changeSummary,
}))
const changedCount = results.filter(r => r.changed).length
log(`review: ${commentTable.length} comments across ${units.length} unit(s); ${changedCount} updated; ${tensions.length} unresolved tension(s)`)

return {
  cloneRoot,
  crux,
  tensions, // surface these to the human FIRST -- they are what the review could not settle
  commentTable, // render as a table: every comment, the round, what the defender did, and his note
  results, // per unit: the full new text / remade image / plan, ready for a fresh agent to apply
  summary: `${commentTable.length} comments across ${units.length} unit(s); ${changedCount} updated; ${tensions.length} unresolved tension(s)${tensions.length ? ' for you to rule on' : ''}.`,
}
