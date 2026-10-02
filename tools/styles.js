// node tools/styles.js — one bot per play style, to check that each style can win and earns the stars it should.
// env: DIFF=easy|normal|hard|hell (default normal), REGION=taiwan|germany|texas (default all three),
//      SEEDS=24, ONLY=<style name prefix>
// Columns: wins, stars of the wins (1★/2★/3★), mean raw score of the wins (no difficulty bonus), mean steam of the wins
// over 2041-2050 (GJ per tonne captured; the star gate),
// blackout months, supply cuts suffered (gas + coal), and why the losses lost.
const M = require('../game/model.js');
if (process.env.COAL) { const [c, m] = process.env.COAL.split(','); M.PLANT_TYPES.coal.build = { cost: +c, months: +m }; }   // what-if: COAL=cost,months
if (process.env.DEEPF) M.DEEP.costFrac = +process.env.DEEPF;   // what-if: share of the capture cost for the 99 % upgrade
const SEEDS = Array.from({ length: +(process.env.SEEDS || 24) }, (_, i) => i + 1);
const RESERVE = 80;
const buy = (s, cost) => s.funds - cost > RESERVE;

function price(s) {
  const fair = M.fairPrice(s);
  let p = Math.round(fair * 1.1);
  if (s.funds < 100) p += 6;
  if (s.funds < -100) p += 6;
  if (s.anger > 40) p = Math.min(p, fair);                       // watch the anger meter: back to the accepted price
  if (s.anger > 60) p = Math.min(p, Math.round(fair * 0.95));
  if (s.funds > 1500) p = Math.min(p, Math.round(fair * 1.05));
  M.setPrice(s, p);
}
function decide(s) {
  const ev = s.pending; if (!ev) return;
  const L = s.last;
  let i = 0;
  if (ev.id === 'policy') { const pref = 'credit,pilot,grant,grid,saving,engage,bonds'.split(','); i = ev.opts.map(o => pref.indexOf(o.pid)).reduce((best, v, k, a) => v < a[best] ? k : best, 0); }
  else if (ev.id === 'storage') { const o = M.offCost(s, 6); i = (s.greenhouse + o.rise < 35 && s.anger > 35) || s.anger > 70 ? 1 : 0; }
  else if (ev.id === 'heat') { const o = M.offCost(s, 3); i = (L && L.netCap > L.demand * 1.14) || s.greenhouse + o.rise > 40 ? 1 : 0; }
  else if (ev.id === 'nox') i = s.funds > 100 + RESERVE ? 0 : 1;
  else if (ev.id === 'typhoon') { const u = L.units.find(x => x.id === ev.plant); i = (s.funds > 100 && L.netCap - (u ? u.netCap : 0) < L.demand * 1.1) ? 0 : 1; }
  M.choose(s, i);
}
const netOf = p => p.gross * (1 - (p.tech ? M.penalty(p, p.tech) : 0));
// a player counts capture already queued: it will eat power when it starts
const capOf = p => { const v = M.planned(p); return v.gross * (1 - (v.tech ? M.penalty(Object.assign({}, p, v), v.tech, v.deep) : 0)); };
const haveCap = s => s.plants.reduce((a, p) => a + capOf(p), 0);   // with plants still being built
const capOnline = s => s.plants.reduce((a, p) => a + (p.build && (p.build.kind === 'new' || p.build.kind === 'convert') ? 0 : capOf(p)), 0);
const now = s => M.START_YEAR + s.m / 12;
const coalFirst = s => s.plants.slice().sort((a, b) => (a.type === 'coal' ? 0 : 1) - (b.type === 'coal' ? 0 : 1));
const q = (s, p, job) => { const c = M.canQueue(s, p, job); if (c.ok && buy(s, c.cost)) { M.enqueue(s, p.id, job); return true; } return false; };

// st: lab (research order; 'screen' stops once a wanted solvent is found), want (solvents, best first), first (solvent
// before that), procs (add-ons to fit), deep (99 % when the limit closes in), build ('gas' | 'coal'), convert (coal -> gas)
function bot(st) {
  // a sensible player: must-do jobs in order (urgent capacity, capture on bare plants, 99 % when the limit closes in,
  // capacity for 3 years out, repowering), and if one cannot be paid for yet, saves instead of buying anything else;
  // research, add-ons and better solvents come from what is left above a reserve
  const LAB_RESERVE = 250;
  return s => {
    price(s);
    const want = st.want || [];
    const main = want.find(id => s.unlocked[id]) || st.first;
    const type = st.build || 'gas';
    let saving = false;
    const must = (needed, tryIt) => { if (saving || !needed) return; if (!tryIt()) saving = true; };
    const build = () => { const c = M.canBuildPlant(s, type); if (c.ok && s.funds - c.down > 100) { M.buildPlant(s, type); return true; } return c.ok || c.why !== 'Not enough funds'; };
    const building = () => s.plants.some(p => p.build && p.build.kind === 'new');
    // A. urgent capacity
    must(!building() && capOnline(s) < M.capacityNeed(s, now(s)), build);
    // B. capture on bare plants: coal always, gas once the limit 3 years out gets close (a lab-scale solvent goes
    //    on one plant first, MEA meanwhile)
    const tight = s.rate >= M.limitFor(s, now(s) + 3) * 0.75;
    if (st.capture !== false) for (const p of coalFirst(s)) {
      const v = M.planned(p);
      if (v.tech || (p.queue || []).length >= 2 || (v.type !== 'coal' && !tight)) continue;
      must(true, () => (main && q(s, p, { kind: 'tech', tech: main })) || (st.first && q(s, p, { kind: 'tech', tech: st.first })) || !(main || st.first));
    }
    // C. 99 % when the limit closes in (coal first)
    if (st.deep && s.rate >= M.limitFor(s, now(s) + 2.5) * 0.8) for (const p of coalFirst(s)) {
      const v = M.planned(p);
      if (v.tech && !v.deep) must(true, () => q(s, p, { kind: 'deep' }) || M.canQueue(s, p, { kind: 'deep' }).why !== 'Not enough funds');
    }
    // D. capacity for when a new plant would be finished
    must(!building() && haveCap(s) < M.capacityNeed(s, now(s) + M.PLANT_TYPES[type].build.months / 12 + 0.5), build);
    // E. gas only: repower one coal plant at a time while the rest still covers today's need
    if (st.convert && !s.plants.some(p => p.build && p.build.kind === 'convert')) {
      const c = s.plants.find(p => M.planned(p).type === 'coal' && !p.build);
      if (c && haveCap(s) - netOf(c) >= M.capacityNeed(s, now(s))) must(true, () => q(s, c, { kind: 'convert', to: 'gas' }));
    }
    if (saving || s.funds < LAB_RESERVE) return;
    // F. research ('screen' stops once a wanted solvent is found), add-ons, then better solvents on MEA plants
    for (const r of st.lab || []) {
      const done = r === 'screen' ? want.some(id => s.unlocked[id]) || M.canResearch(s, 'screen', 'exp').why === 'Every solvent found' : s.unlocked[r];
      if (done) continue;
      if (!Object.keys(s.research).length) { const c = M.canResearch(s, r, 'exp'); if (c.ok && s.funds - c.cost > LAB_RESERVE) M.startResearch(s, r, 'exp'); }
      break;
    }
    for (const k of st.procs || []) if (s.unlocked[k]) for (const p of s.plants) {
      const v = M.planned(p);
      if (!v.tech || v[k] || (p.queue || []).length >= 3 || (k === 'sf' && !v.deep)) continue;
      if (s.funds > LAB_RESERVE) q(s, p, { kind: k });
    }
    if (main && main !== 'mea90') for (const p of coalFirst(s)) {
      const v = M.planned(p);
      if (v.tech === 'mea90' && (p.queue || []).length < 2 && s.funds > LAB_RESERVE) q(s, p, { kind: 'tech', tech: main });
    }
  };
}
const BEST = ['pe2eg', 'pz', 'ampnmp', 'mdeapz'];
const ALLP = ['as', 'ic', 'sf'];
const STYLES = [
  ['no capture', { capture: false }],
  ['MEA only + 99', { first: 'mea90', deep: true }],
  ['MEA + processes', { first: 'mea90', lab: ALLP, procs: ALLP, deep: true }],
  ['solvent only', { first: 'mea90', lab: ['screen'], want: BEST, deep: true }],
  ['solvent + AS', { first: 'mea90', lab: ['screen', 'as'], want: BEST, procs: ['as'], deep: true }],
  ['full (solvent+processes)', { first: 'mea90', lab: ['screen', 'as', 'ic', 'sf'], want: BEST, procs: ALLP, deep: true }],
  ['gas only (full tech)', { first: 'mea90', lab: ['screen', 'as', 'ic', 'sf'], want: BEST, procs: ALLP, deep: true, convert: true }],
  ['coal only (full tech)', { first: 'mea90', lab: ['screen', 'as', 'ic', 'sf'], want: BEST, procs: ALLP, deep: true, build: 'coal' }],
  ['coal only (MEA)', { first: 'mea90', deep: true, build: 'coal' }],
  ['gas only (MEA)', { first: 'mea90', deep: true, convert: true }],
  ['screen rush → best + 99', { lab: ['screen'], want: ['pe2eg', 'pz', 'ampnmp'], deep: true }],
];
const CUTS = { lng: 1, winter: 1, pipe: 1, smog: 1, coal: 1, gas: 1 };
function run(region, [name, st]) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  const policy = bot(st), res = [];
  for (const seed of SEEDS) {
    const s = M.newGame(seed, region, process.env.DIFF || 'normal');
    let hl = 0; s._cuts = 0;
    while (!s.over) {
      policy(s);
      M.step(s);
      if (s.headline && s.headline.n !== hl) { hl = s.headline.n; if (CUTS[s.headline.id]) s._cuts += 1; }
      if (s.pending) decide(s);
      if (process.env.TRACE && seed === +process.env.TRACE && s.m % 12 === 0) console.log('   ', now(s).toFixed(0), '$' + Math.round(s.funds), 'rate', s.rate.toFixed(2), 'lim', M.limit(s).toFixed(2), 'breach', Math.round(s.greenhouse), 'anger', Math.round(s.anger), 'cap', Math.round(haveCap(s)), '/', Math.round(M.capacityNeed(s, now(s))), 'lab', Object.keys(s.research).join() || '-', 'ang', s.angerParts ? Object.entries(s.angerParts).map(([k, v]) => k[0] + v.toFixed(1)).join(' ') : '', 'blk', s.blackouts, s.plants.map(p => p.id + p.type[0] + ':' + (p.tech || '-') + (p.deep ? '9' : '') + (p.as ? 'a' : '') + (p.ic ? 'i' : '') + (p.sf ? 's' : '') + (p.build ? '*' + p.build.kind : '') + ((p.queue || []).length ? 'q' + p.queue.length : '')).join(' '));
    }
    res.push(s);
  }
  const win = res.filter(s => s.over.win), why = {};
  res.forEach(s => { if (!s.over.win) why[s.over.why] = (why[s.over.why] || 0) + 1; });
  const avg = (a, f) => a.length ? a.reduce((x, s) => x + f(s), 0) / a.length : NaN;
  const st3 = [0, 0, 0, 0]; win.forEach(s => st3[M.stars(s)]++);
  const steam = avg(win, s => M.lateSteam(s)), raw = avg(win, M.rawScore);
  console.log(`  ${name.padEnd(26)} win ${String(win.length).padStart(2)}/${res.length}  ★ ${st3.slice(1).join('/').padEnd(8)} raw ${raw.toFixed(0).padStart(5)}` +
    `  steam ${isNaN(steam) ? '  — ' : steam.toFixed(2)}  CO2 ${avg(res, s => s.cumCO2).toFixed(0).padStart(3)}  blk ${avg(res, s => s.blackouts).toFixed(1).padStart(4)}` +
    (process.env.PARTS ? `  [co2 ${avg(win, s => Math.max(0, 250 - s.cumCO2) * 6).toFixed(0)} ang ${avg(win, s => (100 - s.anger) * 5).toFixed(0)} $ ${avg(win, s => Math.min(3000, Math.max(0, s.funds)) * 0.5).toFixed(0)} cap ${avg(win, s => s.captured * 1.5).toFixed(0)} stm ${avg(win, M.steamPts).toFixed(0)}]` : '') +
    `  cuts ${avg(res, s => s._cuts).toFixed(1)}  $${avg(res, s => s.funds).toFixed(0).padStart(5)}M  plants ${avg(res, s => s.plants.length).toFixed(1)}  ${Object.keys(why).length ? JSON.stringify(why) : ''}`);
}
for (const region of process.env.REGION ? [process.env.REGION] : ['taiwan', 'germany', 'texas']) {
  console.log(`== ${region} ${process.env.DIFF || 'normal'}`);
  STYLES.forEach(x => run(region, x));
}
