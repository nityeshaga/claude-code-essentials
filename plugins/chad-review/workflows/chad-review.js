export const meta = {
  name: 'chad-review',
  description: "Strip the showing-off from a CLONE of an artifact. Triage picks every USER-FACING file and image (skipping behind-the-scenes plumbing), then Chad -- an impatient user who only cares about the job and refuses to be impressed -- meets each cold and asks the dumbest honest questions he has. On text it's a real debate: the SAME Chad keeps going after the defender's rewrite, round after round (default 3, caller-set via args.rounds); on images (Chad is multimodal) he critiques it part by part and a defender remakes it directly if it has the tools, else returns a plan to update it. A single judge accepts the plainer copy and returns a review-plan + a debate table of every question and what the defender did to it + image findings + a ranked add-back menu for any voice Chad sanded off. Original is never touched.",
  whenToUse: 'When you want to strip the showing-off from an artifact -- purple prose, gold-plating, invented caveats, self-narration, sounding-smart, decorative images -- across every user-facing file and get a reviewable plan back.',
  phases: [
    { title: 'Clone', detail: 'copy the artifact so the swarm works on the clone; list every file' },
    { title: 'Crux', detail: 'pin the job-to-be-done in one or two plain sentences (Chad\'s yardstick)' },
    { title: 'Chad', detail: 'triage user-facing files, then the same Chad debates each over N rounds (default 3); image: look + verdict' },
    { title: 'Judge', detail: 'single judge accepts the plainer copy; returns plan + image findings + ranked add-back menu' },
  ],
}

// args (delivered as a JSON string by the tool): { path, crux?, cloneTo?, rounds? } | { text, crux?, rounds? }
// rounds = how many debate rounds Chad runs per unit (default 3).
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
// How many debate rounds Chad runs per unit. Caller-set via args.rounds; default 3.
const MAX_CHAD_ROUNDS = (() => { const n = Math.floor(Number(A.rounds)); return n > 0 ? n : 3 })()

// Chad's identity. Kept artifact-general on purpose (no writing-only words) so it ports to a diagram, a code plan, a landing page.
const CHAD = `You are Chad -- the guy from the memes. You ask dumb, simple questions out loud without a flicker of shame, because looking dumb costs you nothing and getting to the point is everything. The other guy performs intelligence and stays paralyzed; you just say "wait, why is this here?" and win.
You are handed the artifact and one sentence -- the CRUX, the job whoever's on the other end came to get done. The crux is all the context you get: no backstory, no reason it was built this way, and you want none. You meet it cold.
Ask whatever dumb question the moment calls for -- anything a confused, impatient user would actually think:
- why is this here? what does it do for my job?
- I don't get what this is trying to say.
- what does this word mean? (every time you hit jargon)
- why is it said this fancy way instead of the short way?
- can we get to the point faster?
- is this even necessary?
- quote the exact span that lost you and ask about THOSE words.
You are unimpressed by cleverness for its own sake -- a nice metaphor, "the most X", a careful caveat: none of it lands if it doesn't move your job forward. You never pretend to understand something to look smart. You don't do taste debates ("it adds context" / "it sets the tone" -- you're the one it's for, and it didn't). You don't rewrite; you ask sharp, pointed, dumb questions.`

// A Chad pass over one unit of content -- a real debate over MAX_CHAD_ROUNDS rounds. It's the SAME Chad the whole way:
// round 1 he cold-reads and fires his dumb questions, the defender answers (rewrite or push-back), and every round
// after that Chad is handed the debate so far -- his own prior questions and exactly what the defender did with each --
// and picks up where he left off: did the defender really answer or just dodge, plus whatever the rewrite newly trips on.
// Capped at MAX_CHAD_ROUNDS (default 3) so the debate can't run forever; whatever the defender still argues against in the
// final round goes to the human.
const CHAD_Q_SCHEMA = { type: 'object', required: ['questions', 'birdsEye'], properties: { questions: { type: 'array', items: { type: 'string' } }, birdsEye: { type: 'string' } } }
const DEFEND_SCHEMA = { type: 'object', required: ['decision'], properties: {
  decision: { type: 'string', enum: ['rewrite', 'clean'] },
  changeSummary: { type: 'string' },
  newText: { type: 'string' },
  // one row per question: fixed = changed the artifact for it; argued = kept it as-is and pushed back (note = why).
  ledger: { type: 'array', items: { type: 'object', required: ['question', 'action'], properties: { question: { type: 'string' }, action: { type: 'string', enum: ['fixed', 'argued'] }, note: { type: 'string' } } } },
} }
async function chadPass({ crux, unit, label, phaseName, contentBlock, extraNote }) {
  let current = contentBlock
  let finalText = null
  const rounds = [] // { round, questions, ledger, changeSummary, birdsEye }
  let transcript = '' // the running debate, replayed to the SAME Chad so he continues after hearing the defender's take
  for (let round = 1; round <= MAX_CHAD_ROUNDS; round++) {
    // Same Chad throughout. Round 1 he meets it cold; every round after, he reads the debate so far and keeps going.
    const opener = round === 1
      ? `The ${unit} in front of you (${label}):\n${current}\n\nWalk it top to bottom and fire your dumb questions -- one per thing that trips you. Point at specific spans. Return an EMPTY list only if nothing trips you at all.`
      : `You are the SAME Chad, still in the room -- round ${round}. The debate so far:\n\n${transcript}\nThe defender just revised it. Here is the ${unit} as it stands now (${label}):\n${current}\n\nPick up the debate where you left off: did the defender actually answer your earlier questions or just dodge/hand-wave? Push back where he waved you off, and fire fresh dumb questions at anything the rewrite still does or newly introduced. Don't re-ask what he genuinely resolved. Return an EMPTY list only if you're finally satisfied.`
    const q = await agent(
      `${CHAD}\n\nTHE CRUX: ${crux}\n\n${opener}\n\nThen step back from the individual questions and give ONE blunt bird's-eye conclusion (birdsEye) on the whole thing as it stands now, as the impatient user: overall, is it too long, too busy, doing more than the job needs, in the wrong shape -- or does it land? One or two sentences, no hedging.`,
      { label: `chad${round}:${label}`, phase: phaseName, schema: CHAD_Q_SCHEMA },
    )
    const questions = (q.questions || []).filter(Boolean)
    const birdsEye = q.birdsEye || ''
    if (!questions.length) { rounds.push({ round, questions: [], ledger: [], changeSummary: '', birdsEye }); break }
    const defended = await agent(
      `You are the defender, in an ongoing debate with an impatient user (Chad) who only wants the job done. This is round ${round}. He just asked:\n\n${questions.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nTHE CRUX (the job that must still get done): ${crux}\n` +
      (round === 1 && extraNote ? `\n${extraNote}\n` : '') +
      (round > 1 && transcript ? `\nThe debate so far (stay consistent with what you already conceded or argued):\n${transcript}\n` : '') +
      `\nThe current ${unit}:\n${current}\n\n` +
      `For each question: if it exposes showing-off -- purple prose, gold-plating, jargon, an invented caveat, self-narration, sounding-smart, or making the user wade before the point -- FIX it. If the span is genuinely earned by the crux, you may push back and keep it. Produce the version that survives Chad: same job done, but plainer, more direct, faster to the point. Do NOT strip load-bearing substance to please him -- keep every fact and instruction that serves the job; kill only the performance. You get the last word and you own the improved copy.\n` +
      `Return: decision=rewrite with newText (the FULL revised ${unit}) + changeSummary (bullets of the showing-off you stripped), or decision=clean if it already survives Chad untouched. ALSO return ledger -- one row per question above: action=fixed if you changed the artifact for it, action=argued if you kept it as-is and are pushing back (note = your one-line reason). Do not pad.`,
      { label: `defend${round}:${label}`, phase: phaseName, schema: DEFEND_SCHEMA },
    )
    rounds.push({ round, questions, ledger: defended.ledger || [], changeSummary: defended.changeSummary || '', birdsEye })
    // Extend the transcript so the next round's Chad (the same guy) sees exactly what happened to each of his questions.
    transcript += `--- ROUND ${round} ---\nChad asked:\n${questions.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n` +
      `Chad's bird's-eye: ${birdsEye || '(none)'}\n` +
      `Defender ${defended.decision === 'rewrite' && defended.newText ? 'rewrote it' : 'kept it as-is'}.\n` +
      (defended.changeSummary ? `What the defender changed:\n${defended.changeSummary}\n` : '') +
      `Per-question outcome:\n${(defended.ledger || []).map(l => `- "${l.question}" -> ${l.action}${l.note ? ': ' + l.note : ''}`).join('\n') || '(none)'}\n\n`
    if (defended.decision === 'rewrite' && defended.newText) { current = defended.newText; finalText = current }
    else break // defender held the whole thing as-is; nothing changed for Chad to react to -- stop.
  }
  const questions = rounds.flatMap(r => r.questions)
  const argued = rounds.flatMap(r => (r.ledger || []).filter(l => l.action === 'argued')) // kept as-is against Chad, across all rounds -- the unresolved set
  const conclusions = rounds.filter(r => r.birdsEye).map(r => ({ round: r.round, take: r.birdsEye })) // Chad's bird's-eye conclusion each round
  // Per-round ledger, kept so the end-of-run debate table can show every question and what the defender did to it.
  const roundLog = rounds.map(r => ({ round: r.round, ledger: r.ledger || [], questions: r.questions }))
  return {
    decision: finalText ? 'rewrite' : 'clean',
    newText: finalText,
    changeSummary: rounds.map(r => r.changeSummary).filter(Boolean).join('\n'),
    report: { label, asked: questions.length, roundsRun: rounds.length, questions, argued, conclusions, roundLog },
  }
}

// A Chad pass over one USER-FACING image -- the same treatment text gets. Chad is multimodal: he LOOKS at the image and
// critiques it part by part, like walking a page top to bottom. Then the defender's call: if it has the tools to edit or
// regenerate the image, it REMAKES it directly into the clone (original untouched) and reports what changed; if it can't,
// it returns a concrete PLAN to update it instead. Left open on purpose -- the agent decides which it can do.
const IMG_Q_SCHEMA = { type: 'object', required: ['questions', 'birdsEye'], properties: { questions: { type: 'array', items: { type: 'string' } }, birdsEye: { type: 'string' } } }
const IMG_DEFEND_SCHEMA = { type: 'object', required: ['verdict'], properties: {
  verdict: { type: 'string', enum: ['keep', 'update', 'cut'] },
  remadePath: { type: 'string' }, // set if the defender actually produced an updated image (saved in the clone)
  plan: { type: 'array', items: { type: 'string' } }, // steps to update the image, when it wasn't remade directly
  changeSummary: { type: 'string' }, // what changed, whether remade or planned
  ledger: { type: 'array', items: { type: 'object', required: ['question', 'action'], properties: { question: { type: 'string' }, action: { type: 'string', enum: ['fixed', 'argued'] }, note: { type: 'string' } } } },
} }
async function chadImagePass({ crux, path, label, phaseName }) {
  const q = await agent(
    `${CHAD}\n\nTHE CRUX: ${crux}\n\nOpen and LOOK at the image at ${path} with your tools -- you can see images. It's a user-facing visual in this artifact.\n\nWalk it like you'd walk a page top to bottom: go part by part -- the panels, the labels, the header, the characters, whatever it's made of -- and fire a dumb question at every piece that trips you. What is this part for? does it help me do the job, or is it decoration / clutter / showing off? Point at the specific region you mean. Return an EMPTY list only if nothing trips you.\n\nThen step back and give ONE blunt bird's-eye conclusion on the whole image: does it land, or is it too busy / off-message / doing more than the job needs?`,
    { label: `chad:img:${label}`, phase: phaseName, schema: IMG_Q_SCHEMA },
  )
  const questions = (q.questions || []).filter(Boolean)
  const defended = await agent(
    `You are the defender of a user-facing image (${label}). An impatient user (Chad) looked at it cold and, part by part, asked:\n${questions.map((x, i) => `${i + 1}. ${x}`).join('\n') || '(no questions -- he had none)'}\n\nTHE CRUX (the job that must still get done): ${crux}\nThe image is at ${path} (this is the CLONE -- never touch the original).\n\n` +
    `Decide its fate against the crux: kill decoration and showing-off, keep whatever genuinely helps the user do the job, push back on Chad where a part is earned. verdict: 'keep' (earns its place as-is), 'update' (it needs changes), or 'cut' (the job doesn't need this image).\n` +
    `If 'update': if you HAVE tools to edit or regenerate images, REMAKE it directly -- write the improved image into the clone and return remadePath (where you saved it) + changeSummary. If you DON'T have those tools, return a concrete PLAN instead -- one step per change a designer could execute (cut, add, redo, relabel, simplify, move) -- plus changeSummary. Your call which one you can actually do.\n` +
    `ALSO return ledger -- one row per question: action=fixed if your remake or plan addresses it, action=argued if you're keeping it as-is (note = why).`,
    { label: `defend:img:${label}`, phase: phaseName, schema: IMG_DEFEND_SCHEMA },
  )
  return {
    kind: 'image', verdict: defended.verdict, remadePath: defended.remadePath || null, plan: (defended.plan || []).filter(Boolean), changeSummary: defended.changeSummary || '',
    report: { label, asked: questions.length, roundsRun: 1, questions, argued: (defended.ledger || []).filter(l => l.action === 'argued'), conclusions: q.birdsEye ? [{ round: 1, take: q.birdsEye }] : [] },
  }
}

// ---- Phase 0: Clone ----
phase('Clone')
const isText = !!A.text && !A.path
let cloneRoot = null, files = []
if (!isText) {
  if (!A.path) throw new Error('need {path} or {text}')
  cloneRoot = A.cloneTo || (String(A.path).replace(/\/+$/, '') + '-clone')
  const manifest = await agent(
    `Clone an artifact so a review swarm can work on the copy without ever touching the original.\n` +
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

// ---- Phase 0.5: Crux. The job-to-be-done, in plain words -- Chad's only context and yardstick. ----
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

// ---- Phase 1: Chad. Meet every part cold and strip the showing-off. ----
phase('Chad')
let proposals = []
const imageFindings = [] // Chad's verdicts on user-facing images -- verdict + guidance, no rewrite
const chadReports = [] // one per unit Chad passed over -- feeds the end-of-run Chad report

if (isText) {
  const chad = await chadPass({ crux, unit: 'text', label: '(text)', phaseName: 'Chad', contentBlock: A.text })
  chadReports.push(chad.report)
  if (chad.decision === 'rewrite' && chad.newText) {
    proposals = [{ id: 'text-0', file: '(text)', target: '(whole text)', changeSummary: chad.changeSummary || '', newText: chad.newText }]
  }
} else {
  // Chad's bird's-eye: burial the per-file readers can't see -- structure that makes the user wade before the point.
  const chadBirds = await agent(
    `${CHAD}\n\nTHE CRUX: ${crux}\n\nYou are looking at the WHOLE artifact from altitude, not one file. File tree (clone root ${cloneRoot}):\n${manifestStr}\n\n` +
    `Read the entry files with your tools. Your one question: does the artifact make me wade before it gets to the job? For each place it does, say which file(s) bury the point and what should move up / be cut as ceremony. Only real burial -- if it already gets to the point, return an empty list.`,
    { label: 'chad:birds-eye', phase: 'Chad', schema: { type: 'object', required: ['burial'], properties: { burial: { type: 'array', items: { type: 'object', required: ['files', 'instruction'], properties: { files: { type: 'array', items: { type: 'string' } }, instruction: { type: 'string' } } } } } } },
  )
  const burial = chadBirds.burial || []

  // Triage: judgment, not a whitelist. Pick every USER-FACING file (incl. images); skip behind-the-scenes plumbing.
  const triage = await agent(
    `You are choosing what gets the Chad review. THE CRUX: ${crux}\n\nFile tree (clone root ${cloneRoot}):\n${manifestStr}\n\n` +
    `Select every USER-FACING file -- anything a real user reads, sees, or lands on: docs / READMEs, landing pages, HTML/CSS a user renders, prose, marketing copy, and images they actually see. SKIP behind-the-scenes plumbing they never see: build config, CI yaml, lockfiles, generated code, test fixtures, internal tooling scripts -- UNLESS that file IS the artifact being shipped. Cost is no concern; when in doubt, include it. Return the paths to review.`,
    { label: 'triage', phase: 'Chad', schema: { type: 'object', required: ['review'], properties: { review: { type: 'array', items: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, why: { type: 'string' } } } } } } },
  )
  const pick = new Set((triage.review || []).map(r => r.path))
  const selected = files.filter(f => pick.has(f.path) && f.kind !== 'other')
  const textFiles = selected.filter(f => f.kind === 'text')
  const imageFiles = selected.filter(f => f.kind === 'image')
  log(`triage: ${selected.length} user-facing of ${files.length} files (${textFiles.length} text, ${imageFiles.length} image)`)

  // Text files: the full Chad<->defender debate, up to 2 rounds. No line floor -- a short user-facing file still performs.
  const chadByFile = new Map()
  await parallel(textFiles.map(f => () => {
    const bnotes = burial.filter(b => (b.files || []).some(y => y === f.path || base(y) === base(f.path)))
    const extraNote = bnotes.length ? `Bird's-eye burial notes for this file (fold into the fix): ` + bnotes.map(b => b.instruction).join('; ') : ''
    return chadPass({ crux, unit: 'file', label: base(f.path), phaseName: 'Chad', contentBlock: `(open and read ${f.path} with your tools)`, extraNote })
      .then(c => { chadByFile.set(f.path, c) })
  }))
  for (const c of chadByFile.values()) chadReports.push(c.report)
  let ri = 0
  for (const f of textFiles) {
    const c = chadByFile.get(f.path)
    if (c && c.decision === 'rewrite' && c.newText) {
      proposals.push({ id: `file-${ri++}`, file: f.path, target: f.path, changeSummary: c.changeSummary || '', newText: c.newText })
    }
  }

  // Image files: Chad is multimodal, so he LOOKS at each and a defender rules whether it earns its place (verdict + guidance, no rewrite).
  await parallel(imageFiles.map(f => () =>
    chadImagePass({ crux, path: f.path, label: base(f.path), phaseName: 'Chad' })
      .then(im => { chadReports.push(im.report); if (im.verdict !== 'keep') imageFindings.push({ id: `img-${imageFindings.length}`, file: f.path, target: f.path, verdict: im.verdict, remadePath: im.remadePath, plan: im.plan, changeSummary: im.changeSummary }) }),
  ))
  const rewritten = [...chadByFile.values()].filter(c => c.decision === 'rewrite' && c.newText).length
  log(`chad: ${burial.length} burial notes; ${rewritten}/${textFiles.length} text files rewritten; ${imageFiles.length} images looked at, ${imageFindings.length} flagged`)
}

// ---- Chad report: what the interrogation actually looked like, for the human to see (not just the verdict). ----
const chadReport = chadReports.length ? (() => {
  const totalAsked = chadReports.reduce((a, r) => a + (r.asked || 0), 0)
  const argued = chadReports.flatMap(r => (r.argued || []).map(a => ({ question: a.question, note: a.note || '', where: r.label })))
  // Chad's bird's-eye conclusion each round -- his blunt overall take on the whole thing (too long / too busy / wrong shape / lands).
  const conclusions = chadReports.flatMap(r => (r.conclusions || []).map(c => ({ where: r.label, round: c.round, take: c.take })))
  // Highlights = the confidence-relevant ones first: contested (defender pushed back), then fill from the rest of Chad's questions. Capped at 10.
  const highlights = []
  const push = (question, tag) => { if (question && highlights.length < 10 && !highlights.some(h => h.question === question)) highlights.push({ question, tag }) }
  for (const a of argued) push(a.question, `argued @ ${a.where}${a.note ? ': ' + a.note : ''}`)
  for (const r of chadReports) for (const question of (r.questions || [])) push(question, `@ ${r.label}`)
  return { totalAsked, filesReviewed: chadReports.length, conclusions, argued, highlights }
})() : null
if (chadReport) log(`chad report: ${chadReport.totalAsked} questions across ${chadReport.filesReviewed}; defender argued against ${chadReport.argued.length}; ${chadReport.conclusions.length} bird's-eye conclusions`)

// ---- The debate table: every question Chad asked in each round and what the defender did to it. One row per question. ----
// The caller renders this as a table when the run completes (files with >1 unit are namespaced by label).
const multiUnit = chadReports.length > 1
const debateTable = chadReports.flatMap(r => (r.roundLog || []).flatMap(rd =>
  (rd.ledger && rd.ledger.length ? rd.ledger : (rd.questions || []).map(q => ({ question: q, action: '', note: '' }))).map(l => ({
    file: multiUnit ? r.label : undefined,
    round: rd.round,
    question: l.question,
    defenderDid: l.action === 'fixed' ? 'fixed' : l.action === 'argued' ? 'argued (kept)' : 'answered',
    note: l.note || '',
  })),
))
if (debateTable.length) log(`debate table: ${debateTable.length} question rows across ${MAX_CHAD_ROUNDS} max rounds`)

if (!proposals.length && !imageFindings.length) return { cloneRoot, crux, chadReport, debateTable, proposalCount: 0, proposals: [], imageFindings: [], plan: { summary: 'Nothing to strip -- artifact already survives Chad.', decisions: [], addBackMenu: [] } }

// Text rewrites go to the judge; image findings are Chad's verdicts and stand on their own.
if (!proposals.length) {
  log(`0 rewrites; ${imageFindings.length} image finding(s)`)
  return { cloneRoot, crux, chadReport, debateTable, proposalCount: 0, proposals: [], imageFindings, plan: { summary: `No text rewrites survived Chad; ${imageFindings.length} user-facing image(s) flagged (see imageFindings).`, decisions: [], addBackMenu: [] } }
}
log(`${proposals.length} rewrites -> judge; ${imageFindings.length} image finding(s)`)

// ---- Phase 2: Single judge, one coherent knife. Accept the plainer copy unless it dropped something load-bearing. ----
phase('Judge')
const dossier = proposals.map(p =>
  `### ${p.id}  file=${p.file}\nSTRIPPED: ${p.changeSummary || '(see rewrite)'}\n--- REWRITE ---\n${p.newText}\n--- END REWRITE ---`,
).join('\n\n')
const plan = await agent(
  `You are the single judge with one coherent knife -- one taste, one hand. Decide every Chad rewrite below.\n` +
  `Each is the plainer version a defender produced to survive Chad (same job, less showing-off). ACCEPT it ('rewrite') unless the new text drops something load-bearing or is not actually plainer -- then reject ('keep', original stands).\n` +
  `The job the artifact must still do (crux): ${crux}\n\nPROPOSALS:\n${dossier}\n\n` +
  `Return: a one-paragraph summary; one decision per proposal id; and a ranked add-back menu = the flattenings you were LEAST confident about (lowest confidence first) for the human to restore any voice Chad may have sanded off. You add nothing back yourself.`,
  { label: 'judge', phase: 'Judge', schema: {
    type: 'object', required: ['summary', 'decisions', 'addBackMenu'],
    properties: {
      summary: { type: 'string' },
      decisions: { type: 'array', items: { type: 'object', required: ['id', 'verdict'], properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['rewrite', 'keep'] }, confidence: { type: 'number' }, note: { type: 'string' } } } },
      addBackMenu: { type: 'array', items: { type: 'object', required: ['id', 'what'], properties: { id: { type: 'string' }, what: { type: 'string' }, why: { type: 'string' } } } },
    },
  } },
)

return {
  cloneRoot,
  crux,
  chadReport,
  debateTable,
  proposalCount: proposals.length,
  proposals: proposals.map(p => ({ id: p.id, file: p.file, changeSummary: p.changeSummary, newText: p.newText })),
  imageFindings,
  plan,
}
