// node tools/sim.js [noev] — "sensible player" bots with different technology plans; env REGION=taiwan|germany|texas, DIFF=easy|normal|hard|hell, ONLY=<name prefix>, TRACE=1
const M = require('../game/model.js');
if (process.argv[2] === 'noev') { M.CFG.P_CHOICE = 0; M.CFG.P_FORCED = 0; }
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const RESERVE = 80;

function price(s) {
  let p = Math.round(M.REGIONS[process.env.REGION || 'taiwan'].fair * (+(process.env.BASE || 1.1)));
  if (s.funds < 100) p += 6;
  if (s.funds < -100) p += 6;
  if (s.anger > 55) p -= 8;
  const fair = M.REGIONS[s.region].fair;
  if (s.anger > 75) p = Math.min(p, Math.round(fair * 0.95));
  if (s.funds > 1500) p = Math.min(p, Math.round(fair * 1.05));
  M.setPrice(s, p);
}
function decide(s) {
  const ev = s.pending; if (!ev) return;
  const L = s.last;
  let i = 0;
  if (ev.id === 'policy') { const pref = (process.env.POLPREF || 'credit,pilot,grant,grid,saving,engage,bonds').split(','); i = ev.opts.map(o => pref.indexOf(o.pid)).reduce((best, v, k, a) => v < a[best] ? k : best, 0); }
  else if (ev.id === 'storage') { const o = M.offCost(s, 6); i = (s.greenhouse + o.rise < 35 && s.anger > 35) || s.anger > 70 ? 1 : 0; }
  else if (ev.id === 'heat') { const o = M.offCost(s, 3); i = (L && L.netCap > L.demand * 1.14) || s.greenhouse + o.rise > 40 ? 1 : 0; }
  else if (ev.id === 'nox') i = s.funds > 100 + RESERVE ? 0 : 1;
  else if (ev.id === 'typhoon') { const u = L.units.find(x => x.id === ev.plant); i = (s.funds > 100 && L.netCap - (u ? u.netCap : 0) < L.demand * 1.1) ? 0 : 1; }
  M.choose(s, i);
}
const buy = (s, cost) => s.funds - cost > RESERVE;
function install(s, p, tech) {
  const c = M.canInstall(s, p, tech);
  if (c.ok && buy(s, c.cost)) { M.install(s, p.id, tech); return true; }
  return false;
}
function research(s, id) { const mt = process.env.METHOD || 'exp'; const c = M.canResearch(s, id, mt); if (c.ok && buy(s, c.cost)) M.startResearch(s, id, mt); }
// keep 20 % spare capacity: build gas plants (fast and cheap) when short
function capacity(s, type = 'gas') {
  const L = s.last;
  const building = s.plants.some(p => p.build && p.build.kind === 'new');
  if (L && !building && L.netCap < M.peakDemand(s) * 1.15) { const c = M.canBuildPlant(s, type); if (c.ok && s.funds - c.cost > 30) M.buildPlant(s, type); }
}
// late game: when emissions approach the limit 2.5 years out, go 99 % (coal first) or convert coal to gas
function lateGame(s, how) {
  const soon = M.limitFor(s, M.START_YEAR + s.m / 12 + 2.5);
  if (s.rate < soon * 0.8 || s.plants.some(p => !p.tech && !p.build)) return;
  const order = s.plants.slice().sort((a, b) => (a.type === 'coal' ? 0 : 1) - (b.type === 'coal' ? 0 : 1));
  for (const p of order) {
    if (p.build) continue;
    const L = s.last, u = L && L.units.find(x => x.id === p.id);
    const spare = L && L.netCap - (u ? u.netCap : 0) > L.demand * 1.1;
    if (how !== 'deep' && p.type === 'coal' && spare) { const c = M.canConvert(s, p, 'gas'); if (c.ok && buy(s, c.cost)) { M.convert(s, p.id, 'gas'); return; } }
    if (how === 'gasOnly') continue;
    const c = M.canUpgrade(s, p);
    if (c.ok && buy(s, c.cost)) M.upgrade(s, p.id);   // a player upgrades every plant they can afford
  }
}
function plan(o) {
  // o.first: tech to install right away; o.lab: research order; o.main: tech once unlocked; o.late: 'deep' | 'convert'
  return s => {
    price(s);
    for (const r of o.lab) { if (r === 'screen' ? M.canResearch(s, 'screen', 'exp').why !== 'Every solvent found' : !s.unlocked[r]) { research(s, r); break; } }
    const mains = [].concat(o.main || []);
    const main = mains.find(id => s.unlocked[id]) || o.first;
    if (main) {
      const gm = o.gasMain && s.unlocked[o.gasMain] ? o.gasMain : null;
      // a player queues capture on every bare plant they can afford, coal first
      const bares = s.plants.filter(p => !p.tech && !p.build && M.online(p)).sort((a, b) => (a.type === 'coal' ? 0 : 1) - (b.type === 'coal' ? 0 : 1));
      for (const q of bares) install(s, q, q.type === 'gas' && gm ? gm : main);
      // plants under construction get capture queued so it starts the day they come online
      for (const q of s.plants.filter(p => p.build && p.build.kind === 'new' && !(p.queue || []).length)) {
        const tech = q.type === 'gas' && gm ? gm : main, c = M.canQueue(s, q, { kind: 'tech', tech });
        if (c.ok && buy(s, c.cost)) M.enqueue(s, q.id, { kind: 'tech', tech });
      }
      if (!bares.length) {
        if (gm) { const g = s.plants.find(p => !p.build && p.type === 'gas' && p.tech && p.tech !== gm); if (g) install(s, g, gm); }
        const sw = s.plants.find(p => !p.build && p.tech && p.tech !== main && p.tech !== gm && !p.deep); if (sw) install(s, sw, main);
      }
    }
    capacity(s);
    if (o.late) lateGame(s, o.late);
  };
}
function run(name, policy) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  const res = [];
  const every = +(process.env.EVERY || 1);   // a human checks in every N months, a bot every month
  for (const seed of SEEDS) {
    const s = M.newGame(seed, process.env.REGION, process.env.DIFF || "easy");
    while (!s.over) {
      if (s.m % every === 0) policy(s);
      M.step(s); if (s.pending) decide(s);
      if (process.env.TRACE && seed === 1 && s.m % 24 === 0) console.log('  ', M.START_YEAR + s.m / 12, 'funds', Math.round(s.funds), 'rate', s.rate.toFixed(2), 'lim', M.limit(s).toFixed(2), 'breach', Math.round(s.greenhouse), 'anger', Math.round(s.anger), 'price', s.price, 'unserved', s.last.unservedFrac.toFixed(2), s.plants.map(p => p.type[0] + (p.tech ? (p.deep ? '9' : '+') : '-') + (p.build ? '*' : '') + ((p.queue || []).length ? 'q' : '')).join(' '));
    }
    res.push(s);
  }
  const win = res.filter(s => s.over.win), why = {};
  res.forEach(s => { if (!s.over.win) why[s.over.why] = (why[s.over.why] || 0) + 1; });
  const avg = (a, f) => a.length ? a.reduce((x, s) => x + f(s), 0) / a.length : NaN;
  const st = [0, 0, 0, 0]; win.forEach(s => st[M.stars(s)]++);
  const endY = res.filter(s => !s.over.win).slice(0, 6).map(s => (M.START_YEAR + s.m / 12).toFixed(0) + ':' +
    s.plants.map(p => (p.type === 'coal' ? 'c' : 'g') + (p.tech ? (p.deep ? '9' : '+') : '-')).join(''));
  console.log(`${name.padEnd(28)} win ${String(win.length).padStart(2)}/${res.length} score ${avg(win, M.score).toFixed(0).padStart(5)} ★ ${st.slice(1).join('/')}` +
    ` CO2 ${avg(res, s => s.cumCO2).toFixed(0).padStart(3)} anger ${avg(res, s => s.anger).toFixed(0).padStart(3)} funds ${avg(res, s => s.funds).toFixed(0).padStart(5)}` +
    ` ach nz/lights/calm ${win.filter(s => s.rate < 0.5).length}/${win.filter(s => s.blackouts === 0).length}/${win.filter(s => s.maxAnger < 50).length}` +
    ` plants ${avg(res, s => s.plants.length).toFixed(1)} fails ${avg(res, s => s.fails).toFixed(1)} blk ${avg(res, s => s.blackouts).toFixed(1)} ${JSON.stringify(why)} ${endY.join(' ')}`);
}
run('nothing', s => { price(s); capacity(s); });
run('MEA only, no 99', plan({ first: 'mea90', lab: [] }));
run('MEA + 99 when needed', plan({ first: 'mea90', lab: [], late: 'deep' }));
run('MEA + coal→gas + 99', plan({ first: 'mea90', lab: [], late: 'convert' }));
run('MEA, RPB + 99', plan({ first: 'mea90', lab: ['rpb'], main: 'rpb', late: 'deep' }));
run('MEA, MCFC on gas + 99', plan({ first: 'mea90', lab: ['mcfc'], gasMain: 'mcfc', late: 'deep' }));
run('MEA, AS + 99', plan({ first: 'mea90', lab: ['afs'], main: 'afs', late: 'deep' }));
run('MEA, screen → best + 99', plan({ first: 'mea90', lab: ['screen'], main: ['pz', 'pe2eg', 'ampnmp', 'afs'], late: 'deep' }));
run('screen+RPB+MCFC + 99', plan({ first: 'mea90', lab: ['screen', 'rpb', 'mcfc'], main: ['pz', 'pe2eg', 'rpb', 'ampnmp'], gasMain: 'mcfc', late: 'deep' }));
run('screen rush → best + 99', plan({ first: null, lab: ['screen'], main: ['pz', 'pe2eg', 'ampnmp', 'afs'], late: 'deep' }));
run('screen → best, no 99', plan({ first: 'mea90', lab: ['screen'], main: ['pz', 'pe2eg', 'ampnmp', 'afs'] }));
