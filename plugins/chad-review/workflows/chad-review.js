export const meta = {
  name: 'chad-review',
  description: "Strip the showing-off from a CLONE of an artifact. Chad -- an impatient user who only cares about the job and refuses to be impressed -- meets each part cold and asks the dumbest honest questions he has; a defender ties every span to the job or rewrites it plainer. A FRESH Chad re-reads the rewrite (up to 2 rounds, so new showing-off can't sneak back in), then a single judge accepts the plainer copy and returns a review-plan + a ranked add-back menu for any voice Chad sanded off. Original is never touched.",
  whenToUse: 'When you want to strip the showing-off from an artifact -- purple prose, gold-plating, invented caveats, self-narration, sounding-smart -- and get a reviewable, file-grained plan of plainer rewrites back.',
  phases: [
    { title: 'Clone', detail: 'copy the artifact so the swarm works on the clone' },
    { title: 'Crux', detail: 'pin the job-to-be-done in one or two plain sentences (Chad\'s yardstick)' },
    { title: 'Chad', detail: 'Chad meets each part cold and asks dumb questions; a defender rewrites it plainer; a fresh Chad re-reads the rewrite (up to 2 rounds)' },
    { title: 'Judge', detail: 'single judge accepts the plainer copy; returns plan + ranked add-back menu' },
  ],
}

// args (delivered as a JSON string by the tool): { path, crux?, cloneTo? } | { text, crux? }
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

// A Chad pass over one unit of content, up to 2 rounds. Each round: a FRESH, amnesiac Chad cold-reads the current
// version and the defender updates it. Round 2's Chad reads round 1's rewrite (a new generation can smuggle in fresh
// slop), and the defender gets one last pass to fix whatever Chad is still unimpressed by. Capped at 2 rounds so the
// polish loop can't run forever; whatever the defender argues against in the final pass goes to the human.
const CHAD_Q_SCHEMA = { type: 'object', required: ['questions', 'birdsEye'], properties: { questions: { type: 'array', items: { type: 'string' } }, birdsEye: { type: 'string' } } }
const DEFEND_SCHEMA = { type: 'object', required: ['decision'], properties: {
  decision: { type: 'string', enum: ['rewrite', 'clean'] },
  changeSummary: { type: 'string' },
  newText: { type: 'string' },
  // one row per question: fixed = changed the artifact for it; argued = kept it as-is and pushed back (note = why).
  ledger: { type: 'array', items: { type: 'object', required: ['question', 'action'], properties: { question: { type: 'string' }, action: { type: 'string', enum: ['fixed', 'argued'] }, note: { type: 'string' } } } },
} }
const MAX_CHAD_ROUNDS = 2
async function chadPass({ crux, unit, label, phaseName, contentBlock, extraNote }) {
  let current = contentBlock
  let finalText = null
  const rounds = [] // { round, questions, ledger, changeSummary, birdsEye }
  for (let round = 1; round <= MAX_CHAD_ROUNDS; round++) {
    // Fresh Chad every round -- he must meet THIS version cold, with no memory of the last round (that is the whole power).
    const q = await agent(
      `${CHAD}\n\nTHE CRUX: ${crux}\n\nThe ${unit} in front of you (${label}):\n${current}\n\nWalk it top to bottom and fire your dumb questions -- one per thing that trips you. Point at specific spans. Return an EMPTY list only if nothing trips you at all.\n\nThen step back from the individual questions and give ONE blunt bird's-eye conclusion (birdsEye) on the whole thing, as the impatient user: overall, is it too long, too busy, doing more than the job needs, in the wrong shape -- or does it land? One or two sentences, no hedging.`,
      { label: `chad${round}:${label}`, phase: phaseName, schema: CHAD_Q_SCHEMA },
    )
    const questions = (q.questions || []).filter(Boolean)
    const birdsEye = q.birdsEye || ''
    if (!questions.length) { rounds.push({ round, questions: [], ledger: [], changeSummary: '', birdsEye }); break }
    const defended = await agent(
      `You are the defender. An impatient user (Chad) who only wants the job done looked at ${label} cold and asked these dumb questions:\n\n${questions.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nTHE CRUX (the job that must still get done): ${crux}\n` +
      (round === 1 && extraNote ? `\n${extraNote}\n` : '') +
      `\nThe current ${unit}:\n${current}\n\n` +
      `For each question: if it exposes showing-off -- purple prose, gold-plating, jargon, an invented caveat, self-narration, sounding-smart, or making the user wade before the point -- FIX it. If the span is genuinely earned by the crux, you may push back and keep it. Produce the version that survives Chad: same job done, but plainer, more direct, faster to the point. Do NOT strip load-bearing substance to please him -- keep every fact and instruction that serves the job; kill only the performance. You get the last word and you own the improved copy.\n` +
      `Return: decision=rewrite with newText (the FULL revised ${unit}) + changeSummary (bullets of the showing-off you stripped), or decision=clean if it already survives Chad untouched. ALSO return ledger -- one row per question above: action=fixed if you changed the artifact for it, action=argued if you kept it as-is and are pushing back (note = your one-line reason). Do not pad.`,
      { label: `defend${round}:${label}`, phase: phaseName, schema: DEFEND_SCHEMA },
    )
    rounds.push({ round, questions, ledger: defended.ledger || [], changeSummary: defended.changeSummary || '', birdsEye })
    if (defended.decision === 'rewrite' && defended.newText) { current = defended.newText; finalText = current }
    else break // defender held the whole thing as-is; a fresh read would just repeat -- stop.
  }
  const questions = rounds.flatMap(r => r.questions)
  const argued = rounds.flatMap(r => (r.ledger || []).filter(l => l.action === 'argued')) // kept as-is against Chad, across both rounds -- the unresolved set
  const conclusions = rounds.filter(r => r.birdsEye).map(r => ({ round: r.round, take: r.birdsEye })) // Chad's bird's-eye conclusion each round
  return {
    decision: finalText ? 'rewrite' : 'clean',
    newText: finalText,
    changeSummary: rounds.map(r => r.changeSummary).filter(Boolean).join('\n'),
    report: { label, asked: questions.length, roundsRun: rounds.length, questions, argued, conclusions },
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
    `Then list every text file in the clone with line counts:\n  find "${cloneRoot}" -type f \\( -name '*.md' -o -name '*.rb' -o -name '*.js' -o -name '*.txt' -o -name '*.py' \\) -print0 | xargs -0 wc -l\n` +
    `Return every file path (absolute, under the clone root) and its line count.`,
    { label: 'clone', phase: 'Clone', schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'object', required: ['path', 'lines'], properties: { path: { type: 'string' }, lines: { type: 'integer' } } } } } } },
  )
  files = (manifest.files || []).filter(f => f.path && !/\/\.git\//.test(f.path))
  if (!files.length) throw new Error('clone produced no files -- aborting rather than reviewing an empty artifact')
}
const manifestStr = files.map(f => `${f.path} (${f.lines}L)`).join('\n')
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

  // Every substantial file meets Chad. Tiny files rarely perform; skip them to save agents.
  const reviewable = files.filter(f => f.lines >= 30)
  const chadByFile = new Map()
  await parallel(reviewable.map(f => () => {
    const bnotes = burial.filter(b => (b.files || []).some(y => y === f.path || base(y) === base(f.path)))
    const extraNote = bnotes.length ? `Bird's-eye burial notes for this file (fold into the fix): ` + bnotes.map(b => b.instruction).join('; ') : ''
    return chadPass({ crux, unit: 'file', label: base(f.path), phaseName: 'Chad', contentBlock: `(open and read ${f.path} with your tools)`, extraNote })
      .then(c => { chadByFile.set(f.path, c) })
  }))
  const rewritten = [...chadByFile.values()].filter(c => c.decision === 'rewrite' && c.newText).length
  for (const c of chadByFile.values()) chadReports.push(c.report)
  log(`chad: ${burial.length} burial notes; ${rewritten}/${reviewable.length} files rewritten to survive Chad`)

  let ri = 0
  for (const f of reviewable) {
    const c = chadByFile.get(f.path)
    if (c && c.decision === 'rewrite' && c.newText) {
      proposals.push({ id: `file-${ri++}`, file: f.path, target: f.path, changeSummary: c.changeSummary || '', newText: c.newText })
    }
  }
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

if (!proposals.length) return { cloneRoot, crux, chadReport, proposalCount: 0, proposals: [], plan: { summary: 'Nothing to strip -- artifact already survives Chad.', decisions: [], addBackMenu: [] } }
log(`${proposals.length} rewrites -> judge`)

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
  proposalCount: proposals.length,
  proposals: proposals.map(p => ({ id: p.id, file: p.file, changeSummary: p.changeSummary, newText: p.newText })),
  plan,
}
