export const meta = {
  name: 'elon-algorithm',
  description: "Run Elon's algorithm (question -> delete -> simplify) on a CLONE of an artifact. Review has two altitudes: a bird's-eye pass that decides cross-file fate (delete whole files/dirs, map cross-file redundancy) runs FIRST, then one per-file reviewer returns each surviving file's single coarse outcome (leaner rewrite | delete | keep). An asymmetric debate (deletion gets the last word) and a cut-by-default judge return a cut-plan + ranked add-back menu. Original is never touched.",
  whenToUse: 'When you want to aggressively simplify an artifact (a skill bundle, a code file, a piece of writing) and get a reviewable, file-grained cut-plan back.',
  phases: [
    { title: 'Clone', detail: 'copy the artifact so the swarm works on the clone' },
    { title: 'Review', detail: "bird's-eye (cross-file fate + redundancy map) -> per-file (one coarse outcome per surviving file)" },
    { title: 'Debate', detail: 'per proposal: lone objection -> deletion rebuttal (deletion gets last word)' },
    { title: 'Judge', detail: 'single judge, cuts by default; returns cut-plan + ranked add-back menu' },
  ],
}

// args (delivered as a JSON string by the tool): { path, standardHint?, cloneTo? } | { text, standardHint? }
const A = (() => { try { return typeof args === 'string' ? JSON.parse(args) : (args || {}) } catch (e) { throw new Error('args not valid JSON: ' + e.message) } })()
const base = p => (p ? String(p).split('/').pop() : '?')

const STANDARD = A.standardHint || 'say what is load-bearing, cut everything else; do as much as needed, as little as possible (Jensen Huang).'
const LENSES = `Lenses (faces of question->delete->simplify; apply whichever fit):
- provenance: did a human ask for this, or did the AI invent it?
- altitude: wrong level of abstraction -- could a higher-level move do this in far fewer lines?
- redundancy: duplicates something elsewhere (mirror dirs, vendored docs, restated guidance).
- premature-generality: built for a future that may never come.
- dead-weight: padding, hedging, ceremony, restating the obvious.`

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

// ===== Single-text mode: one reviewer, straight to judge (no bundle altitudes) =====
let proposals = []
if (isText) {
  phase('Review')
  const r = await agent(
    `Run Elon's algorithm on the text below. Default stance: DELETE. Return ONE coarse outcome: a single leaner rewrite (action=rewrite, newText=the rewrite, changeSummary=bullets of what you cut). Don't pad -- you're generating, so every kept sentence must earn its place.\nStandard: ${STANDARD}\n${LENSES}\n\nTEXT:\n${A.text}`,
    { label: 'text', phase: 'Review', schema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['rewrite', 'keep'] }, why: { type: 'string' }, changeSummary: { type: 'string' }, newText: { type: 'string' }, linesRemoved: { type: 'integer' } } } },
  )
  if (r.decision === 'rewrite') proposals = [{ id: 'text-0', altitude: 'editorial', file: '(text)', action: 'rewrite', target: '(whole text)', why: r.why || '', changeSummary: r.changeSummary || '', lines: r.linesRemoved || 0, newText: r.newText || null }]
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

  // ===== Phase 1b: Per-file. ONE coarse outcome per surviving file (rewrite | delete | keep). Sectional + editorial merged. =====
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

  proposals = [
    ...wholeUnits.map((w, i) => ({ id: `whole-${i}`, altitude: 'structural', file: w.target, action: w.action, target: w.target, why: w.why || '', changeSummary: '', lines: w.lines || 0, newText: null })),
    ...perFile.filter(x => x.r.decision && x.r.decision !== 'keep').map((x, i) => ({ id: `file-${i}`, altitude: 'per-file', file: x.f.path, action: x.r.decision, target: x.f.path, why: x.r.why || '', changeSummary: x.r.changeSummary || '', lines: x.r.linesRemoved || 0, newText: x.r.newText || null })),
  ]
}

if (!proposals.length) return { cloneRoot, proposalCount: 0, proposals: [], plan: { summary: 'Nothing to cut -- artifact is already lean.', decisions: [], addBackMenu: [] } }
log(`${proposals.length} proposals (file-grained, no cap) -> debate`)

// ===== Phase 2: Asymmetric debate. Deletion already argued in Review; objection is the lone tripwire; deletion gets the LAST word. =====
phase('Debate')
const debated = (await parallel(proposals.map(p => () => (async () => {
  const ctx = `Proposed change (the default outcome is DELETE):\n- file: ${p.file}\n- action: ${p.action}\n- why: ${p.why}` +
    (p.changeSummary ? `\n- what it cuts: ${p.changeSummary}` : '') +
    (p.newText ? `\n- (full-file REWRITE; the proposed leaner text is below)\n--- REWRITE ---\n${p.newText}\n--- END REWRITE ---` : '')
  const objection = await agent(
    `${ctx}\n\nYou are the ONLY check against over-aggressive deletion -- a narrow tripwire, not a debate partner. Read the file (${p.file}) if useful. Name ONLY a CONCRETE thing that breaks if this is cut/rewritten: a specific instruction that would be lost, the single place some fact/example/hook-order appears, a cross-reference that would dangle. "It's useful", "adds context", "nice to have" are NOT breakage -- if that's all you've got, say "no concrete breakage."`,
    { label: `opp:${p.id}`, phase: 'Debate' },
  )
  const rebuttal = await agent(
    `${ctx}\n\nObjection raised:\n${objection}\n\nYou argue for deletion and you get the LAST word. Is the objection a real concrete breakage, or dressed-up "it's useful"? If it names something genuinely load-bearing, concede exactly that sliver should be preserved (and how to keep it while still cutting the rest). Otherwise, hold the full cut.`,
    { label: `reb:${p.id}`, phase: 'Debate' },
  )
  return { ...p, objection, rebuttal }
})()))).filter(Boolean)

// ===== Phase 3: Single judge, one coherent knife, cuts BY DEFAULT. =====
phase('Judge')
const dossier = debated.map(p =>
  `### ${p.id}  [${p.altitude}]  action=${p.action}  file=${p.file}${p.newText ? `  (REWRITE -${p.lines}L)` : ''}\n` +
  `WHY CUT: ${p.why}${p.changeSummary ? `\nCUTS: ${p.changeSummary}` : ''}\nOBJECTION: ${p.objection}\nREBUTTAL (deletion's last word): ${p.rebuttal}`,
).join('\n\n')
const plan = await agent(
  `You are the single judge with one coherent knife -- one taste, one hand. Decide every proposed change below.\n` +
  `DEFAULT VERDICT IS CUT. Keep something ONLY if the objection named a concrete, specific breakage the rebuttal failed to dissolve. "Seems useful / adds context / nice to have" is NOT grounds to keep -- that is the slop being removed. Be ambitious: this artifact should end up dramatically smaller.\n` +
  `Verdicts: 'cut' (delete the file / accept the structural cut), 'rewrite' (accept the leaner text), 'keep' (reject -- original stands).\n` +
  `Standard the artifact aspires to: ${STANDARD}\n\nPROPOSALS:\n${dossier}\n\n` +
  `Return: a one-paragraph summary including projected total lines removed; one decision per proposal id; and a ranked add-back menu = the cuts you were LEAST confident about (lowest confidence first) for the human to restore their 10%. You add nothing back yourself.`,
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
  proposalCount: proposals.length,
  proposals: debated.map(p => ({ id: p.id, altitude: p.altitude, file: p.file, action: p.action, lines: p.lines, changeSummary: p.changeSummary, newText: p.newText })),
  plan,
}
