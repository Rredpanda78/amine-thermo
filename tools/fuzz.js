// node tools/fuzz.js [games] — random players doing random legal (and illegal) actions; must print "no invariant violations"
const M = require('../game/model.js');
const N = +(process.argv[2] || 2000);
let rngS = 12345;
const rnd = () => { rngS = (rngS * 1103515245 + 12345) >>> 0; return rngS / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const bad = [];
function check(s, where) {
  const nums = { funds: s.funds, anger: s.anger, greenhouse: s.greenhouse, cumCO2: s.cumCO2, captured: s.captured, rate: s.rate, noCapCO2: s.soldTotal, savedMWh: s.taxPaid };
  for (const [k, v] of Object.entries(nums)) if (!Number.isFinite(v)) bad.push(`${where}: ${k}=${v}`);
  if (s.plants.length < 1 || s.plants.length > M.MAX_PLANTS) bad.push(`${where}: plants=${s.plants.length}`);
  if (s.greenhouse < 0 || s.greenhouse > 100) bad.push(`${where}: breach=${s.greenhouse}`);
  if (s.anger < 0 || s.anger > 100) bad.push(`${where}: anger=${s.anger}`);
  if (new Set(s.plants.map(p => p.id)).size !== s.plants.length) bad.push(`${where}: duplicate plant ids`);
  for (const p of s.plants) {
    if (p.tech && !M.TECHS[p.tech]) bad.push(`${where}: unknown tech ${p.tech}`);
    if (p.build && !(p.build.left >= 0)) bad.push(`${where}: build left ${p.build.left}`);
    if (p.deep && !p.tech) bad.push(`${where}: deep without tech`);
    if ((p.queue || []).length > M.QUEUE_MAX) bad.push(`${where}: queue ${p.queue.length}`);
    for (const j of p.queue || []) if (!(j.paid >= 0)) bad.push(`${where}: queued job paid ${j.paid}`);
  }
  if ((s.labQueue || []).length > M.QUEUE_MAX) bad.push(`${where}: lab queue ${s.labQueue.length}`);
  if (s.last) for (const u of s.last.units) if (!Number.isFinite(u.netCap) || u.netCap < 0) bad.push(`${where}: unit ${u.id} netCap ${u.netCap}`);
}
const t0 = Date.now();
let wins = 0, months = 0, actions = 0;
for (let g = 0; g < N && bad.length < 20; g++) {
  const s = M.newGame(1 + g, pick(['taiwan', 'germany', 'texas']));
  while (!s.over) {
    if (process.env.HELP) {            // keep the city alive so late-game code paths run
      M.setPrice(s, 112);
      for (const q of s.plants) if (!q.tech && !q.build) M.install(s, q.id, s.unlocked.pe2eg ? 'pe2eg' : 'mea90');
      if (s.m > 150) for (const q of s.plants) M.upgrade(s, q.id);
      const L = s.last; if (L && L.netCap < L.demand * 1.15) M.buildPlant(s, 'gas');
    }
    const nAct = Math.floor(rnd() * 3);
    for (let k = 0; k < nAct; k++) {
      const p = s.plants.length ? pick(s.plants) : null;
      const a = Math.floor(rnd() * 13);
      try {
        if (a === 0 && p) M.install(s, p.id, pick(M.TECH_ORDER));
        else if (a === 1 && p) M.upgrade(s, p.id);
        else if (a === 2 && p && rnd() < 0.2) M.convert(s, p.id, pick(['gas', 'gasb', 'coal', undefined]));
        else if (a === 3 && rnd() < 0.15) M.buildPlant(s, pick(['coal', 'gas']));
        else if (a === 4 && p && rnd() < 0.05) M.demolish(s, p.id);
        else if (a === 5) M.startResearch(s, pick(M.LAB_ORDER));
        else if (a === 6) M.setPrice(s, 60 + rnd() * 120);
        else if (a === 7) M.install(s, 'ZZ', 'mea90');          // bogus id must not crash
        else if (a === 8 && p) M.enqueue(s, p.id, pick([{ kind: 'tech', tech: pick(M.TECH_ORDER) }, { kind: 'deep' }, { kind: 'convert', to: pick(['gas', 'gasb', 'coal']) }, { kind: 'ic' }, { kind: 'sf' }, { kind: 'bogus' }]));
        else if (a === 9 && p) M.cancelJob(s, p.id, Math.floor(rnd() * 4));
        else if (a === 10) M.enqueueResearch(s, pick(M.LAB_ORDER), pick(['exp', 'comp']));
        else if (a === 11) M.cancelResearch(s, Math.floor(rnd() * 3));
        else if (a === 12) M.cancelJob(s, 'ZZ', 1);
        if (rnd() < 0.02) M.setFlex(s, rnd() < 0.5);
        actions++;
      } catch (e) { bad.push(`game ${g} m ${s.m} action ${a}: ${e.message}`); }
    }
    try { M.step(s); } catch (e) { bad.push(`game ${g} m ${s.m} step: ${e.message}`); break; }
    if (s.pending) { try { M.choose(s, Math.floor(rnd() * s.pending.opts.length)); } catch (e) { bad.push(`game ${g} choose: ${e.message}`); } }
    check(s, `game ${g} m ${s.m}`);
    months++;
  }
  if (s.over && s.over.win) wins++;
  try { M.score(s); M.stars(s); } catch (e) { bad.push(`game ${g} score: ${e.message}`); }
}
console.log(`${N} games, ${months} months, ${actions} actions, ${wins} random wins, ${Date.now() - t0} ms`);
console.log(bad.length ? 'PROBLEMS:\n' + bad.slice(0, 20).join('\n') : 'no invariant violations');
