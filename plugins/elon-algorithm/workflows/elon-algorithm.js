export const meta = {
  name: 'elon-algorithm',
  description: "Run Elon's algorithm (question -> delete -> simplify) on a CLONE of an artifact, along two axes: DELETE (cut what isn't load-bearing) and CHAD (strip showing-off so the artifact survives an impatient user who only cares about the job). Bird's-eye cross-file fate runs first, then per-file: the delete lane returns each surviving file's coarse outcome (rewrite | delete | keep), then Chad meets each survivor cold and a defender rewrites it plainer. An asymmetric deletion debate + a cut-by-default judge return a cut-plan + ranked add-back menu. Original is never touched.",
  whenToUse: 'When you want to aggressively simplify an artifact (a skill bundle, a code file, a landing page, prose) AND strip the showing-off, and get a reviewable, file-grained plan back.',
  phases: [
    { title: 'Clone', detail: 'copy the artifact so the swarm works on the clone' },
    { title: 'Crux', detail: 'pin the job-to-be-done in one or two plain sentences (Chad\'s yardstick)' },
    { title: 'Review', detail: "delete lane: bird's-eye (cross-file fate + redundancy) -> per-file coarse outcome" },
    { title: 'Chad', detail: 'Chad meets each survivor cold and asks dumb questions; a defender rewrites it; a fresh Chad re-reads the rewrite (up to 2 rounds)' },
    { title: 'Debate', detail: 'per cut: lone objection -> deletion rebuttal (deletion gets last word)' },
    { title: 'Judge', detail: 'single judge, cuts by default, cut beats rewrite; returns plan + ranked add-back menu' },
  ],
}

// args (delivered as a JSON string by the tool): { path, crux?, standardHint?, cloneTo? } | { text, crux?, standardHint? }
const A = (() => { try { return typeof args === 'string' ? JSON.parse(args) : (args || {}) } catch (e) { throw new Error('args not valid JSON: ' + e.message) } })()
const base = p => (p ? String(p).split('/').pop() : '?')

const STANDARD = A.standardHint || 'say what is load-bearing, cut everything else; do as much as needed, as little as possible (Jensen Huang).'
const LENSES = `Lenses (faces of question->delete->simplify; apply whichever fit):
- provenance: did a human ask for this, or did the AI invent it?
- altitude: wrong level of abstraction -- could a higher-level move do this in far fewer lines?
- redundancy: duplicates something elsewhere (mirror dirs, vendored docs, restated guidance).
- premature-generality: built for a future that may never come.
- dead-weight: padding, hedging, ceremony, restating the obvious.`

// Chad's identity -- the second axis. Kept artifact-general on purpose (no writing-only words).
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

// A Chad pass over one unit of surviving content, up to 2 rounds. Each round: a FRESH, amnesiac Chad cold-reads
// the current version and the defender updates it. Round 2's Chad reads round 1's rewrite (a new generation can
// smuggle in fresh slop), and the defender gets one last pass to fix whatever Chad is still unimpressed by.
// Capped at 2 rounds so the polish loop can't run forever; whatever the defender argues against in the final pass goes to the human.
const CHAD_Q_SCHEMA = { type: 'object', required: ['questions'], properties: { questions: { type: 'array', items: { type: 'string' } } } }
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
  const rounds = [] // { round, questions, ledger, changeSummary }
  for (let round = 1; round <= MAX_CHAD_ROUNDS; round++) {
    // Fresh Chad every round -- he must meet THIS version cold, with no memory of the last round (that is the whole power).
    const q = await agent(
      `${CHAD}\n\nTHE CRUX: ${crux}\n\nThe ${unit} in front of you (${label}):\n${current}\n\nWalk it top to bottom and fire your dumb questions -- one per thing that trips you. Point at specific spans. Return an EMPTY list only if nothing trips you at all.`,
      { label: `chad${round}:${label}`, phase: phaseName, schema: CHAD_Q_SCHEMA },
    )
    const questions = (q.questions || []).filter(Boolean)
    if (!questions.length) { rounds.push({ round, questions: [], ledger: [], changeSummary: '' }); break }
    const defended = await agent(
      `You are the defender. An impatient user (Chad) who only wants the job done looked at ${label} cold and asked these dumb questions:\n\n${questions.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nTHE CRUX (the job that must still get done): ${crux}\n` +
      (round === 1 && extraNote ? `\n${extraNote}\n` : '') +
      `\nThe current ${unit}:\n${current}\n\n` +
      `For each question: if it exposes showing-off -- purple prose, gold-plating, jargon, an invented caveat, self-narration, sounding-smart, or making the user wade before the point -- FIX it. If the span is genuinely earned by the crux, you may push back and keep it. Produce the version that survives Chad: same job done, but plainer, more direct, faster to the point. Do NOT strip load-bearing substance to please him -- keep every fact and instruction that serves the job; kill only the performance. You get the last word and you own the improved copy.\n` +
      `Return: decision=rewrite with newText (the FULL revised ${unit}) + changeSummary (bullets of the showing-off you stripped), or decision=clean if it already survives Chad untouched. ALSO return ledger -- one row per question above: action=fixed if you changed the artifact for it, action=argued if you kept it as-is and are pushing back (note = your one-line reason). Do not pad.`,
      { label: `defend${round}:${label}`, phase: phaseName, schema: DEFEND_SCHEMA },
    )
    rounds.push({ round, questions, ledger: defended.ledger || [], changeSummary: defended.changeSummary || '' })
    if (defended.decision === 'rewrite' && defended.newText) { current = defended.newText; finalText = current }
    else break // defender held the whole thing as-is; a fresh read would just repeat -- stop.
  }
  const questions = rounds.flatMap(r => r.questions)
  const argued = rounds.flatMap(r => (r.ledger || []).filter(l => l.action === 'argued')) // kept as-is against Chad, across both rounds -- the unresolved set
  return {
    decision: finalText ? 'rewrite' : 'clean',
    newText: finalText,
    changeSummary: rounds.map(r => r.changeSummary).filter(Boolean).join('\n'),
    report: { label, asked: questions.length, roundsRun: rounds.length, questions, argued },
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

// ---- Phase 0.5: Crux. The job-to-be-done, in plain words -- Chad's only context. ----
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

// ===== Single-text mode: delete rewrite, then Chad on the survivor, straight to judge =====
let proposals = []
const chadReports = [] // one per unit Chad passed over -- feeds the end-of-run Chad report
if (isText) {
  phase('Review')
  const r = await agent(
    `Run Elon's algorithm on the text below. Default stance: DELETE. Return ONE coarse outcome: a single leaner rewrite (action=rewrite, newText=the rewrite, changeSummary=bullets of what you cut). Don't pad -- you're generating, so every kept sentence must earn its place.\nStandard: ${STANDARD}\n${LENSES}\n\nTEXT:\n${A.text}`,
    { label: 'text', phase: 'Review', schema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['rewrite', 'keep'] }, why: { type: 'string' }, changeSummary: { type: 'string' }, newText: { type: 'string' }, linesRemoved: { type: 'integer' } } } },
  )
  const leanText = r.decision === 'rewrite' && r.newText ? r.newText : A.text
  let leanCuts = r.decision === 'rewrite' ? (r.changeSummary || '') : ''

  phase('Chad')
  const chad = await chadPass({ crux, unit: 'text', label: '(text)', phaseName: 'Chad', contentBlock: leanText })
  chadReports.push(chad.report)
  if (chad.decision === 'rewrite' && chad.newText) {
    proposals = [{ id: 'text-0', altitude: 'chad', file: '(text)', action: 'rewrite', target: '(whole text)', why: 'delete + Chad pass', changeSummary: [leanCuts, chad.changeSummary].filter(Boolean).join('\n'), lines: r.linesRemoved || 0, newText: chad.newText, chad: true }]
  } else if (r.decision === 'rewrite') {
    proposals = [{ id: 'text-0', altitude: 'editorial', file: '(text)', action: 'rewrite', target: '(whole text)', why: r.why || '', changeSummary: leanCuts, lines: r.linesRemoved || 0, newText: r.newText || null }]
  }
} else {
  // ===== Phase 1a: Bird's-eye. Cross-file fate FIRST (delete-what-shouldn't-exist before simplifying-what-survives). =====
  phase('Review')
  const birdsEye = await agent(
    `You run Elon's algorithm at the BIRD'S-EYE altitude -- the things you can only see by looking ACROSS files, never inside one. File tree (clone root ${cloneRoot}):\n${manifestStr}\n\n` +
    `Read whatever files you need with your tools. Produce two things:\n` +
    `1. wholeUnits -- whole files or whole directories that should be deleted or merged: mirror/parallel doc trees, vendored docs that restate our own guidance, redundant index/nav/boilerplate files, duplicate trees. (action delete-file|merge; target = the exact path/dir; why; lines.) These are the highest-leverage cuts -- be bold.\n` +
    `2. redundancy -- content DUPLICATED across multiple still-surviving files: the same table/section/concept appearing in several files. For each, name the canonical home and which files carry the dupe. You do NOT cut these yourself -- you hand them to the per-file reviewers as instructions. (pattern; canonical = the file that should own it; files = the paths carrying a dupe; instruction = what each should cut.)\n` +
    `Standard: ${STANDARD}\n${LENSES}`,
    { label: 'birds-eye', phase: 'Review', schema: {
      type: 'object', required: ['wholeUnits', 'redundancy'],
      properties: {
        wholeUnits: { type: 'array', items: { type: 'object', required: ['action', 'target', 'why'], properties: { action: { type: 'string', enum: ['delete-file', 'merge'] }, target: { type: 'string' }, why: { type: 'string' }, lines: { type: 'integer' } } } },
        redundancy: { type: 'array', items: { type: 'object', required: ['pattern', 'canonical', 'files', 'instruction'], properties: { pattern: { type: 'string' }, canonical: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, instruction: { type: 'string' } } } },
      },
    } },
  )
  const wholeUnits = birdsEye.wholeUnits || []
  const redundancy = birdsEye.redundancy || []
  // Files whose fate is already sealed at the bird's-eye altitude -- don't simplify a part that's being deleted (the Nevada/Fremont mistake).
  const sealed = p => wholeUnits.some(w => p === w.target || p.startsWith(String(w.target).replace(/\/+$/, '') + '/'))
  const survivors = files.filter(f => f.lines >= 30 && !sealed(f.path))
  log(`bird's-eye: ${wholeUnits.length} whole-unit cuts, ${redundancy.length} cross-file redundancies -> ${survivors.length} files to review`)

  // ===== Phase 1b: Per-file DELETE lane. ONE coarse outcome per surviving file (rewrite | delete | keep). =====
  const perFile = (await parallel(survivors.map(f => () => {
    const notes = redundancy.filter(r => (r.files || []).some(x => x === f.path || base(x) === base(f.path)))
    const notesStr = notes.length ? `\nCross-file findings the bird's-eye pass handed you for THIS file (execute them in your rewrite):\n` + notes.map(n => `- ${n.instruction} (this content's canonical home is ${base(n.canonical)})`).join('\n') : ''
    return agent(
      `You run Elon's algorithm on ONE file and return ONE coarse outcome for it. Read ONLY this file: ${f.path} (${f.lines} lines).\n` +
      `Do all your question->delete->simplify thinking INTERNALLY, then return the file's single result -- not a list of line edits:\n` +
      `- decision=delete-file if the whole file shouldn't exist.\n` +
      `- decision=rewrite if it should be leaner: return newText = the FULL leaner version of the entire file, plus changeSummary = a short bullet list of what you cut/merged. Aim well below the original length; you're generating text, so the trap is re-adding slop -- every kept sentence must earn its place.\n` +
      `- decision=keep if it's already lean (rare; don't invent work, but don't be timid either).\n` +
      `Default stance is DELETE -- the human restores the 10% that truly matters.${notesStr}\nStandard: ${STANDARD}\n${LENSES}`,
      { label: `file:${base(f.path)}`, phase: 'Review', schema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['rewrite', 'delete-file', 'keep'] }, why: { type: 'string' }, changeSummary: { type: 'string' }, newText: { type: 'string' }, linesRemoved: { type: 'integer' } } } },
    ).then(r => ({ f, r }))
  }))).filter(Boolean)

  // ===== Phase 1c: CHAD lane. Runs on files the delete lane keeps alive; the defender builds on the leaner text. =====
  // A file the delete lane cuts never reaches Chad -- that is "cut beats rewrite", for free.
  phase('Chad')
  // Chad's bird's-eye: burial the per-file readers can't see -- structure that makes the user wade before the point.
  const chadBirds = await agent(
    `${CHAD}\n\nTHE CRUX: ${crux}\n\nYou are looking at the WHOLE artifact from altitude, not one file. File tree (clone root ${cloneRoot}):\n${manifestStr}\n\n` +
    `Read the entry files with your tools. Your one question: does the artifact make me wade before it gets to the job? For each place it does, say which file(s) bury the point and what should move up / be cut as ceremony. Only real burial -- if it already gets to the point, return an empty list.`,
    { label: 'chad:birds-eye', phase: 'Chad', schema: { type: 'object', required: ['burial'], properties: { burial: { type: 'array', items: { type: 'object', required: ['files', 'instruction'], properties: { files: { type: 'array', items: { type: 'string' } }, instruction: { type: 'string' } } } } } } },
  )
  const burial = chadBirds.burial || []

  const alive = perFile.filter(x => x.r.decision !== 'delete-file')
  const chadByFile = new Map()
  await parallel(alive.map(x => () => {
    const f = x.f
    const bnotes = burial.filter(b => (b.files || []).some(y => y === f.path || base(y) === base(f.path)))
    const extraNote = bnotes.length ? `Bird's-eye burial notes for this file (fold into the fix): ` + bnotes.map(b => b.instruction).join('; ') : ''
    // Chad reads the file itself; if the delete lane already produced leaner text, start the defender from that.
    const leanBlock = x.r.decision === 'rewrite' && x.r.newText ? x.r.newText : `(open and read ${f.path} with your tools)`
    return chadPass({ crux, unit: 'file', label: base(f.path), phaseName: 'Chad', contentBlock: leanBlock, extraNote })
      .then(c => { chadByFile.set(f.path, { x, c }) })
  }))
  const chadRewrites = [...chadByFile.values()].filter(v => v.c.decision === 'rewrite' && v.c.newText).length
  for (const v of chadByFile.values()) chadReports.push(v.c.report)
  log(`chad: ${burial.length} burial notes; ${chadRewrites}/${alive.length} survivors rewritten to survive Chad`)

  // ===== Merge both lanes into proposals. Chad's rewrite supersedes the delete-lane rewrite of the same file (it was built on top). =====
  proposals = [
    ...wholeUnits.map((w, i) => ({ id: `whole-${i}`, altitude: 'structural', file: w.target, action: w.action, target: w.target, why: w.why || '', changeSummary: '', lines: w.lines || 0, newText: null })),
    ...perFile.filter(x => x.r.decision === 'delete-file').map((x, i) => ({ id: `del-${i}`, altitude: 'per-file', file: x.f.path, action: 'delete-file', target: x.f.path, why: x.r.why || '', changeSummary: '', lines: x.r.linesRemoved || 0, newText: null })),
  ]
  let ri = 0
  for (const x of perFile) {
    if (x.r.decision === 'delete-file') continue
    const chad = chadByFile.get(x.f.path)
    if (chad && chad.c.decision === 'rewrite' && chad.c.newText) {
      // Combined outcome: leaner (delete lane) + plainer (Chad). Chad's defender owns the final copy.
      proposals.push({ id: `file-${ri++}`, altitude: 'chad', file: x.f.path, action: 'rewrite', target: x.f.path, why: x.r.why || 'survives Chad', changeSummary: [x.r.changeSummary, chad.c.changeSummary].filter(Boolean).join('\n'), lines: x.r.linesRemoved || 0, newText: chad.c.newText, chad: true })
    } else if (x.r.decision === 'rewrite') {
      // Delete lane wants it leaner; Chad found it clean. Keep the delete-lane rewrite.
      proposals.push({ id: `file-${ri++}`, altitude: 'per-file', file: x.f.path, action: 'rewrite', target: x.f.path, why: x.r.why || '', changeSummary: x.r.changeSummary || '', lines: x.r.linesRemoved || 0, newText: x.r.newText || null })
    }
  }
}

// ===== Chad report: what the interrogation actually looked like, for the human to see (not just the verdict). =====
const chadReport = chadReports.length ? (() => {
  const totalAsked = chadReports.reduce((a, r) => a + (r.asked || 0), 0)
  const argued = chadReports.flatMap(r => (r.argued || []).map(a => ({ question: a.question, note: a.note || '', where: r.label })))
  // Highlights = the confidence-relevant ones first: contested (defender pushed back), then fill from the rest of Chad's questions. Capped at 10.
  const highlights = []
  const push = (question, tag) => { if (question && highlights.length < 10 && !highlights.some(h => h.question === question)) highlights.push({ question, tag }) }
  for (const a of argued) push(a.question, `argued @ ${a.where}${a.note ? ': ' + a.note : ''}`)
  for (const r of chadReports) for (const question of (r.questions || [])) push(question, `@ ${r.label}`)
  return { totalAsked, filesReviewed: chadReports.length, argued, highlights }
})() : null
if (chadReport) log(`chad report: ${chadReport.totalAsked} questions across ${chadReport.filesReviewed}; defender argued against ${chadReport.argued.length}`)

if (!proposals.length) return { cloneRoot, crux, chadReport, proposalCount: 0, proposals: [], plan: { summary: 'Nothing to cut -- artifact is already lean and survives Chad.', decisions: [], addBackMenu: [] } }
log(`${proposals.length} proposals -> debate`)

// ===== Phase 2: Asymmetric deletion debate. Only CUTS are debated (deletion gets the last word). =====
// Chad rewrites already had their adversarial exchange (Chad asked, the defender answered and owns the copy) -- they skip this.
phase('Debate')
const debated = (await parallel(proposals.map(p => () => (async () => {
  if (p.chad || p.action === 'rewrite') return { ...p, objection: '(n/a -- rewrite; not a cut)', rebuttal: '' }
  const ctx = `Proposed change (the default outcome is DELETE):\n- file: ${p.file}\n- action: ${p.action}\n- why: ${p.why}` +
    (p.changeSummary ? `\n- what it cuts: ${p.changeSummary}` : '')
  const objection = await agent(
    `${ctx}\n\nYou are the ONLY check against over-aggressive deletion -- a narrow tripwire, not a debate partner. Read the file (${p.file}) if useful. Name ONLY a CONCRETE thing that breaks if this is cut: a specific instruction that would be lost, the single place some fact/example/hook-order appears, a cross-reference that would dangle. "It's useful", "adds context", "nice to have" are NOT breakage -- if that's all you've got, say "no concrete breakage."`,
    { label: `opp:${p.id}`, phase: 'Debate' },
  )
  const rebuttal = await agent(
    `${ctx}\n\nObjection raised:\n${objection}\n\nYou argue for deletion and you get the LAST word. Is the objection a real concrete breakage, or dressed-up "it's useful"? If it names something genuinely load-bearing, concede exactly that sliver should be preserved (and how to keep it while still cutting the rest). Otherwise, hold the full cut.`,
    { label: `reb:${p.id}`, phase: 'Debate' },
  )
  return { ...p, objection, rebuttal }
})()))).filter(Boolean)

// ===== Phase 3: Single judge, one coherent knife, cuts BY DEFAULT; cut beats rewrite. =====
phase('Judge')
const dossier = debated.map(p =>
  `### ${p.id}  [${p.altitude}]  action=${p.action}  file=${p.file}${p.newText ? `  (REWRITE -${p.lines}L)` : ''}${p.chad ? '  (Chad-defended)' : ''}\n` +
  `WHY: ${p.why}${p.changeSummary ? `\nCHANGES: ${p.changeSummary}` : ''}${p.objection && p.rebuttal ? `\nOBJECTION: ${p.objection}\nREBUTTAL (deletion's last word): ${p.rebuttal}` : ''}`,
).join('\n\n')
const plan = await agent(
  `You are the single judge with one coherent knife -- one taste, one hand. Decide every proposed change below. There are two kinds:\n` +
  `- CUTS (delete-file / merge): DEFAULT VERDICT IS CUT. Keep only if the objection named a concrete, specific breakage the rebuttal failed to dissolve. "Seems useful / adds context" is NOT grounds to keep.\n` +
  `- REWRITES (leaner and/or Chad-defended plainer text): accept ('rewrite') unless the new text drops something load-bearing or is not actually simpler.\n` +
  `CUT BEATS REWRITE: if you cut a file, reject any rewrite of that same file (don't polish what you're removing).\n` +
  `Be ambitious: the artifact should end up dramatically smaller and plainer.\n` +
  `The job the artifact must still do (crux): ${crux}\nStandard it aspires to: ${STANDARD}\n\nPROPOSALS:\n${dossier}\n\n` +
  `Return: a one-paragraph summary including projected total lines removed; one decision per proposal id; and a ranked add-back menu = the cuts and flattenings you were LEAST confident about (lowest confidence first) for the human to restore their 10% (including any voice Chad may have sanded off). You add nothing back yourself.`,
  { label: 'judge', phase: 'Judge', schema: {
    type: 'object', required: ['summary', 'decisions', 'addBackMenu'],
    properties: {
      summary: { type: 'string' },
      decisions: { type: 'array', items: { type: 'object', required: ['id', 'verdict', 'reason', 'confidence'], properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['cut', 'keep', 'rewrite'] }, reason: { type: 'string' }, confidence: { type: 'number' } } } },
      addBackMenu: { type: 'array', items: { type: 'object', required: ['id', 'whyMightRestore', 'confidence'], properties: { id: { type: 'string' }, whyMightRestore: { type: 'string' }, confidence: { type: 'number' } } } },
    },
  } },
)

return {
  cloneRoot,
  crux,
  chadReport,
  proposalCount: proposals.length,
  proposals: debated.map(p => ({ id: p.id, altitude: p.altitude, file: p.file, action: p.action, lines: p.lines, changeSummary: p.changeSummary, newText: p.newText, chad: !!p.chad })),
  plan,
}
