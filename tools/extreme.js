// node tools/extreme.js [region] — extreme player strategies vs a sensible baseline; env DIFF=..., PX=<price as a multiple of the accepted price, default 1.05>
const M = require('../game/model.js');
const REGION = process.argv[2] || process.env.REGION || 'taiwan';
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 101);
const fair = () => M.REGIONS[REGION].fair;
const PX = +(process.env.PX || 1.05);   // price as a multiple of what people accept
const cheapest = s => ['pe2eg', 'pz', 'rpb', 'ampnmp', 'afs', 'mea90'].find(id => s.unlocked[id]);
const queueCapture = (s, pick, reserve = 60) => {
  // bare plants first (coal before gas), solvent swaps only once every plant has capture
  const bare = s.plants.filter(p => !M.planned(p).tech).sort((a, b) => (a.type === 'coal' ? 0 : 1) - (b.type === 'coal' ? 0 : 1));
  for (const p of bare) { const tech = pick(s, p); if (!tech) continue; const c = M.canQueue(s, p, { kind: 'tech', tech }); if (c.ok && s.funds - c.cost > reserve) M.enqueue(s, p.id, { kind: 'tech', tech }); }
  if (bare.length) return;
  for (const p of s.plants) {
    const v = M.planned(p);
    const tech = pick(s, p);
    if (!tech || v.tech === tech) continue;
    if (v.tech && !p.build && (p.queue || []).length === 0 && v.tech !== 'mea90') continue;   // keep a good solvent once installed
    const c = M.canQueue(s, p, { kind: 'tech', tech });
    if (c.ok && s.funds - c.cost > reserve) M.enqueue(s, p.id, { kind: 'tech', tech });
  }
};
const upgradeAll = (s, when) => {
  const soon = M.limitFor(s, M.START_YEAR + s.m / 12 + 2.5);
  if (!when(s, soon)) return;
  for (const p of s.plants) { const c = M.canQueue(s, p, { kind: 'deep' }); if (c.ok && s.funds - c.cost > 60) M.enqueue(s, p.id, { kind: 'deep' }); }
};
const capacity = (s, margin = 1.15, type = 'gas') => {
  const L = s.last;
  if (L && !s.plants.some(p => p.build && p.build.kind === 'new') && L.netCap < M.peakDemand(s) * margin) {
    const c = M.canBuildPlant(s, type); if (c.ok && s.funds - c.cost > 60) { const r = M.buildPlant(s, type); if (r.ok) M.enqueue(s, r.id, { kind: 'tech', tech: cheapest(s) }); }
  }
};
const decide = s => { if (s.pending) M.choose(s, s.pending.id === 'nox' && s.funds > 200 ? 0 : 1); };
const STRATS = {
  baseline: s => {   // sensible: MEA early, screen, best solvent, 99 % when needed, spare capacity
    M.setPrice(s, Math.round(fair() * PX));
    if (s.funds > 250) M.enqueueResearch(s, 'screen', 'comp');
    queueCapture(s, cheapest);
    capacity(s);
    upgradeAll(s, (s, soon) => s.rate > soon * 0.8);
  },
  tycoon: s => {     // build every plant you can and sell the surplus
    M.setPrice(s, Math.round(fair() * PX));
    if (s.plants.length < M.MAX_PLANTS) { const c = M.canBuildPlant(s, 'gas'); if (c.ok && s.funds - c.cost > 60) { const r = M.buildPlant(s, 'gas'); if (r.ok) M.enqueue(s, r.id, { kind: 'tech', tech: cheapest(s) }); } }
    queueCapture(s, cheapest);
    upgradeAll(s, (s, soon) => s.rate > soon * 0.8);
  },
  labRush: s => {    // queue every lab project on day one, then roll the best out everywhere
    M.setPrice(s, Math.round(fair() * PX));
    for (let i = 0; i < 3; i++) M.enqueueResearch(s, 'screen', 'comp');
    ['afs', 'rpb', 'mcfc'].forEach(id => M.enqueueResearch(s, id));
    queueCapture(s, cheapest);
    capacity(s);
    upgradeAll(s, (s, soon) => s.rate > soon * 0.8);
  },
  only2PE: s => {    // screen until 2PE-EG shows up and install nothing else
    M.setPrice(s, Math.round(fair() * PX));
    if (!s.unlocked.pe2eg) M.enqueueResearch(s, 'screen', 'exp');
    queueCapture(s, s2 => (s2.unlocked.pe2eg ? 'pe2eg' : null));
    capacity(s);
    upgradeAll(s, (s, soon) => s.rate > soon * 0.8);
  },
  gouge: s => {      // squeeze customers: price far above what people accept
    M.setPrice(s, Math.round(fair() * 1.35));
    if (s.funds > 250) M.enqueueResearch(s, 'screen', 'comp');
    queueCapture(s, cheapest); capacity(s);
    upgradeAll(s, (s, soon) => s.rate > soon * 0.8);
  },
  cheap: s => {      // keep everyone happy: price below what people accept
    M.setPrice(s, Math.round(fair() * 0.9));
    if (s.funds > 250) M.enqueueResearch(s, 'screen', 'comp');
    queueCapture(s, cheapest); capacity(s);
    upgradeAll(s, (s, soon) => s.rate > soon * 0.8);
  },
  boiler: s => {     // switch coal to gas in the boiler on day one (cheap), then capture
    M.setPrice(s, Math.round(fair() * PX));
    for (const p of s.plants) if (p.type === 'coal') { const c = M.canQueue(s, p, { kind: 'convert', to: 'gasb' }); if (c.ok && s.funds - c.cost > 60) M.enqueue(s, p.id, { kind: 'convert', to: 'gasb' }); }
    if (s.funds > 250) M.enqueueResearch(s, 'screen', 'comp');
    queueCapture(s, cheapest); capacity(s);
    upgradeAll(s, (s, soon) => s.rate > soon * 0.8);
  },
  process: s => {    // baseline plus intercooling everywhere and split flow on 99 % plants
    STRATS.baseline(s);
    ['ic', 'sf'].forEach(id => { if (s.funds > 300) M.enqueueResearch(s, id); });
    for (const p of s.plants) for (const kind of ['ic', 'sf']) { const c = M.canQueue(s, p, { kind }); if (c.ok && s.funds - c.cost > 150) M.enqueue(s, p.id, { kind }); }
  },
  flexOn: s => {     // baseline plus flexible capture switched on all game
    STRATS.baseline(s);
    if (!s.unlocked.flex && s.funds > 300) M.enqueueResearch(s, 'flex');
    if (s.unlocked.flex) M.setFlex(s, true);
  },
  gasRush: s => {    // the player's recipe: two extra gas plants on day one, screen for 2PE/EG, capture everything, 99 % when needed, no processes
    M.setPrice(s, Math.round(fair() * PX));
    if (s.m < 3 && s.plants.filter(p => p.type === 'gas').length < 3) { const c = M.canBuildPlant(s, 'gas'); if (c.ok && s.funds - c.cost > 60) M.buildPlant(s, 'gas'); }
    if (!s.unlocked.pe2eg && s.funds > 250) M.enqueueResearch(s, 'screen', 'comp');
    queueCapture(s, cheapest); capacity(s);
    upgradeAll(s, (s, soon) => s.rate > soon * 0.8);
  },
  coalMix: s => {    // diversify: one extra coal plant on day one, a gas plant only when short, best solvent, 99 % when needed
    M.setPrice(s, Math.round(fair() * PX));
    if (!s.unlocked.pe2eg && s.funds > 250) M.enqueueResearch(s, 'screen', 'comp');
    queueCapture(s, cheapest); capacity(s, 1.15, 'coal');
    upgradeAll(s, (s, soon) => s.rate > soon * 0.8);
  },
  gasFull: s => {    // the same plus intercooling and split flow everywhere
    STRATS.gasRush(s);
    ['ic', 'sf'].forEach(id => { if (s.funds > 300) M.enqueueResearch(s, id); });
    for (const p of s.plants) for (const kind of ['ic', 'sf']) { const c = M.canQueue(s, p, { kind }); if (c.ok && s.funds - c.cost > 150) M.enqueue(s, p.id, { kind }); }
  },
  deepNow: s => {    // 99 % on everything as soon as possible
    M.setPrice(s, Math.round(fair() * PX));
    queueCapture(s, cheapest); capacity(s);
    upgradeAll(s, () => true);
  },
};
const rows = [];
for (const [name, policy] of Object.entries(STRATS)) {
  const res = [];
  for (const seed of SEEDS) {
    const s = M.newGame(seed, REGION, process.env.DIFF || "easy");
    while (!s.over) { if (s.m % 3 === 0) policy(s); M.step(s); decide(s); }
    res.push(s);
  }
  const win = res.filter(s => s.over.win), why = {};
  res.forEach(s => { if (!s.over.win) why[s.over.why] = (why[s.over.why] || 0) + 1; });
  const avg = (a, f) => a.length ? a.reduce((x, s) => x + f(s), 0) / a.length : NaN;
  const st = [0, 0, 0, 0]; win.forEach(s => st[M.stars(s)]++);
  rows.push(`${name.padEnd(9)} win ${String(win.length).padStart(2)}/24 score ${avg(win, M.score).toFixed(0).padStart(5)} ★${st.slice(1).join('/')} funds ${avg(res, s => s.funds).toFixed(0).padStart(6)} anger ${avg(res, s => s.anger).toFixed(0).padStart(3)} CO2 ${avg(res, s => s.cumCO2).toFixed(0).padStart(3)} plants ${avg(res, s => s.plants.length).toFixed(1)} soldGWh ${avg(res, s => s.soldTotal).toFixed(0).padStart(6)} blk ${avg(res, s => s.blackouts).toFixed(1)} ${JSON.stringify(why)}`);
}
console.log(`== ${REGION}\n` + rows.join('\n'));
