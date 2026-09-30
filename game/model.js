/* Capture City 2050 \u2014 game model v3 (pure logic, no DOM).
 * Used by index.html in the browser and by sim_test.js under node for balancing.
 *
 * Technology numbers come from Lin Research Group papers where the paper reports them;
 * everything marked `est` is a game estimate (the paper does not give that number).
 *   MEA regeneration 3.5 GJ/t ......... Chen, Wu & Lin, Chem. Eng. J. 2026 (155 kJ/mol CO2)
 *   Advanced MEA stripper 2.8 GJ/t .... Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025 (122 kJ/mol)
 *   AMP\u2013NMP 3\u00d7 faster, ~2\u00d7 capacity ... Cheng, Chen & Lin, Chem. Eng. J. 2025 (duty not reported -> est. 3.0,
 *                                       kept above the measured 2PE\u2013EG value; high capacity -> low running cost, est.)
 *                                       AMP carbamate precipitates at high loading (same paper; Chen, Wu & Lin 2026)
 *   2PE\u2013EG 2.9 GJ/t (128 kJ/mol) ...... Chen, Wu & Lin, Chem. Eng. J. 2026 (70 EG/30 H2O; 4.5\u00d7 rate, 2.8\u00d7 capacity;
 *                                       25.8 cP vs 1.7 cP for MEA -> start-up trouble in the heat exchanger)
 *   99 % capture needs 20\u201330 m packing  Chang, Chou & Lin, Sep. Purif. Technol. 2025 (+9 % duty is est.)
 *   QM + MD screening, 28 amines ...... Chien, Wu & Lin, GHGT-18 (2026): reaction \u0394G MAE 3.6 kJ/mol
 *
 * Game rules that are NOT from papers: plant sizes and prices, fuel prices, the CO2 limit path,
 * event odds, start-up failure odds, research costs and times, the gas-capture penalty.
 */
(function (root) {
  'use strict';

  const HOURS = 730;                 // hours per month
  const GJ_TO_MWH_E = 0.069;          // steam heat -> lost electricity (0.25 equivalent-work factor)
  const COMPRESS = 0.10;              // MWh_e per t CO2 for compression + pumps
  const START_YEAR = 2026, END_YEAR = 2050;
  const MONTHS = (END_YEAR - START_YEAR + 1) * 12;   // Jan 2026 .. Dec 2050
  const FAIR_PRICE = 100;             // $/MWh the public accepts
  const BANKRUPT = -500;              // $M
  const MAX_PLANTS = 10;
  const DEMOLISH_COST = 30;           // $M

  // Legal CO2 limit (Mt per year). It tightens every year toward net zero in 2050.
  const LIMIT_POINTS = [[2026, 10.5], [2028, 9.8], [2030, 8.5], [2035, 5.5], [2040, 2.5], [2045, 1.1], [2050, 0.6]];
  const LIMIT_SCALE = 12;             // meter full scale (Mt/yr)
  // breach meter (0-100 %): rises with how far over the limit you are, falls slowly while you stay under it
  const BREACH = { up: 12, down: 5, maxStep: 20 };   // % per month per 100 % over / under the limit
  const PROVEN_MONTHS = 24;           // months of operation before a new solvent stops failing
  const SCREEN_TIME = 0.7, SCREEN_RISK = 0.5;   // QM+MD screening: research time and start-up risk factors
  const DEEP = { capture: 0.99, dutyMul: 1.09, opexAdd: 1, costFrac: 0.35, months: 3 };

  // capexFactor: capture-unit cost per MW relative to coal; dutyMul/opexMul: dilute flue gas costs more per tonne
  const PLANT_TYPES = {
    coal: { label: 'Coal', intensity: 0.95, fuel: 30, fixed: 0.0030, capexFactor: 1.0, dutyMul: 1.0, opexMul: 1.0,
      size: 600, build: { cost: 900, months: 24 } },
    gas:  { label: 'Gas',  intensity: 0.37, fuel: 50, fixed: 0.0020, capexFactor: 0.75, dutyMul: 1.15, opexMul: 1.2,
      size: 400, build: { cost: 420, months: 12 } },
  };
  const CONVERT = { gas: { cost: 200, months: 4 }, coal: { cost: 450, months: 18 } };   // keyed by the new fuel

  // capture: fraction captured; duty: regeneration GJ/t; capex: $M per MW gross (coal basis); opex: $/t captured
  // stage: how far the technology has been scaled up; startup: monthly failure odds until proven; risk: forever
  const TECHS = {
    mea90: {
      name: 'MEA', short: 'MEA', capture: 0.90, duty: 3.5, capex: 1.00, opex: 10,
      unlocked: true, color: '#5B8DEF', stage: 'Commercial', startup: 0,
      pitch: 'Proven and available now, but uses the most steam.',
      fact: '30 wt% MEA, the industry benchmark. Regeneration \u2248 3.5 GJ per tonne CO\u2082.',
      src: 'Chen, Wu & Lin, Chem. Eng. J. 2026',
    },
    afs: {
      name: 'MEA + advanced stripper', short: 'MEA-AS', capture: 0.90, duty: 2.8, capex: 1.15, opex: 10,
      unlocked: false, research: { cost: 80, months: 12 }, color: '#2BB3C0', stage: 'Pilot-tested', startup: 0.012,
      fail: 'the new stripper would not hold steady',
      pitch: 'Same MEA, smarter heat recovery: less steam, safe bet, pricier to build.',
      fact: 'A heat-integrated stripper cuts MEA regeneration to \u2248 2.8 GJ/t.',
      src: 'Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025',
    },
    ampnmp: {
      name: 'AMP\u2013NMP (semi-aqueous)', short: 'AMP-NMP', capture: 0.90, duty: 3.0, capex: 1.10, opex: 8,
      unlocked: false, research: { cost: 100, months: 12 }, color: '#0E9F6E', est: ['duty', 'opex'], stage: 'Lab scale',
      startup: 0.025, risk: 0.006, solvent: true, fail: 'AMP carbamate precipitated and clogged a line',
      pitch: 'Quick to research and cheapest to run, but it can clog at any time.',
      fact: 'NMP does not react with CO\u2082; it makes the hindered amine AMP 3\u00d7 faster than in water, and AMP holds about twice the CO\u2082 of MEA, so less solvent has to circulate. Catch: AMP carbamate can precipitate at high loading and clog lines, even years after start-up.',
      src: 'Cheng, Chen & Lin, Chem. Eng. J. 2025',
    },
    pe2eg: {
      name: '2PE\u2013EG (water-lean)', short: '2PE-EG', capture: 0.90, duty: 2.9, capex: 1.00, opex: 9,
      unlocked: false, research: { cost: 180, months: 24 }, color: '#E2A93B', est: ['capex'], star: true, stage: 'Lab scale',
      startup: 0.035, solvent: true, fail: 'the viscous solvent overloaded the heat exchanger',
      pitch: 'Longest research and shaky first years, then the best all-rounder.',
      fact: 'Ethylene glycol reacts: it turns the carbamate into alkyl carbonate and frees the amine again, so 2-piperidineethanol gets both 4.5\u00d7 faster reaction and 2.8\u00d7 cyclic capacity vs MEA; regeneration 128 kJ/mol (\u2248 2.9 GJ/t). Catch: 15\u00d7 more viscous than MEA.',
      src: 'Chen, Wu & Lin, Chem. Eng. J. 2026',
    },
  };
  const TECH_ORDER = ['mea90', 'afs', 'ampnmp', 'pe2eg'];

  // research projects that are not a capture technology
  const PROJECTS = {
    screen: {
      name: 'QM + MD solvent screening', short: 'QM+MD', cost: 60, months: 12,
      desc: 'solvent research \u221230 % time \u00b7 half the start-up failures',
      fact: 'Quantum chemistry and molecular dynamics predict the reaction \u0394G and \u0394H of 28 amines (MAE 3.6 kJ/mol) before a single experiment.',
      src: 'Chien, Wu & Lin, GHGT-18 (2026)',
    },
  };
  const LAB_ORDER = ['screen', 'afs', 'ampnmp', 'pe2eg'];

  // ---- technology helpers -----------------------------------------------------
  function eff(techId, deep, type) {
    const t = TECHS[techId];
    if (!t) return null;
    const pt = PLANT_TYPES[type || 'coal'];
    const e = { capture: t.capture, duty: t.duty, opex: t.opex };
    if (deep) { e.capture = DEEP.capture; e.duty *= DEEP.dutyMul; e.opex += DEEP.opexAdd; }
    e.duty *= pt.dutyMul; e.opex *= pt.opexMul;
    return e;
  }
  // energy (MWh_e) lost per tonne CO2 captured
  function workPerTonne(e) { return e.duty * GJ_TO_MWH_E + COMPRESS; }
  function penalty(plant, techId, deep) {
    if (deep === undefined) deep = !!plant.deep && plant.tech === techId;
    const e = eff(techId, deep, plant.type);
    if (!e) return 0;
    return PLANT_TYPES[plant.type].intensity * e.capture * workPerTonne(e);
  }
  function capexFull(plant, techId) {
    return TECHS[techId].capex * plant.gross * PLANT_TYPES[plant.type].capexFactor;
  }
  function installCost(state, plant, techId) {
    const full = capexFull(plant, techId);
    let c = plant.tech ? 0.35 * full : full;   // an existing capture unit is retrofitted with a new solvent
    if (state.subsidy > 0) c *= 0.7;
    return Math.round(c);
  }
  function installMonths(plant) { return plant.tech ? 3 : 9; }
  function upgradeCost(state, plant) {
    let c = DEEP.costFrac * capexFull(plant, plant.tech);
    if (state.subsidy > 0) c *= 0.7;
    return Math.round(c);
  }
  function carbonTax(year) { return year < 2030 ? 0 : 50 + 5 * (year - 2030); }
  function limitAt(t) {
    const P = LIMIT_POINTS;
    if (t <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) {
      if (t <= P[i][0]) {
        const [x0, y0] = P[i - 1], [x1, y1] = P[i];
        return y0 + (y1 - y0) * (t - x0) / (x1 - x0);
      }
    }
    return P[P.length - 1][1];
  }
  function limit(state) { return limitAt(START_YEAR + Math.min(state.m, MONTHS - 1) / 12); }
  // monthly change of the breach meter for emissions at `ratio` \u00d7 the allowed rate
  function breachStep(ratio) {
    return ratio > 1 ? Math.min(BREACH.maxStep, BREACH.up * (ratio - 1)) : -BREACH.down * (1 - ratio);
  }
  function gasFuel(state) { return PLANT_TYPES.gas.fuel * state.gasIndex * state.gasMult; }
  // a plant produces power unless it is being built, converted or repaired
  function online(p) { return p.down <= 0 && !(p.build && (p.build.kind === 'new' || p.build.kind === 'convert')); }

  // stage / maturity of a technology in this game
  function maturity(state, techId) {
    const t = TECHS[techId];
    const exp = state.exp[techId] || 0;
    const proven = !t.startup || exp >= PROVEN_MONTHS;
    const risk = proven ? 0 : t.startup * (state.unlocked.screen ? SCREEN_RISK : 1);
    return { stage: t.stage, exp, proven, risk, needs: PROVEN_MONTHS };
  }

  // research projects: capture technologies (TECHS[id].research) and PROJECTS
  function project(id) {
    if (PROJECTS[id]) return Object.assign({ id }, PROJECTS[id]);
    const t = TECHS[id];
    return { id, name: t.name, short: t.short, cost: t.research.cost, months: t.research.months, star: t.star,
      desc: t.pitch, solvent: t.solvent };
  }
  function researchCost(state, id) { return Math.round(project(id).cost * (state.resCut > 0 ? 1.5 : 1)); }
  function researchMonths(state, id) {
    const p = project(id);
    return p.solvent && state.unlocked.screen ? Math.ceil(p.months * SCREEN_TIME) : p.months;
  }

  // small deterministic RNG so a seed replays the same events
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makePlant(id, type) {
    return { id, name: `${PLANT_TYPES[type].label} Plant ${id}`, type, gross: PLANT_TYPES[type].size,
      tech: null, deep: false, build: null, outage: 0, down: 0, downWhy: '', washed: false };
  }
  function newGame(seed) {
    const unlocked = {};
    TECH_ORDER.forEach(id => { unlocked[id] = !!TECHS[id].unlocked; });
    Object.keys(PROJECTS).forEach(id => { unlocked[id] = false; });
    return {
      seed: seed || Math.floor(Math.random() * 1e9),
      m: 0, funds: 700, price: 100, cumCO2: 0, captured: 0, anger: 10,
      greenhouse: 0, maxDebt: 0, rate: 0, recent: [], overMonths: 0, wasOver: false,
      over: null, subsidy: 0, resCut: 0, usCut: false, captureOff: 0, captureOffWhy: '', lngCut: 0,
      plants: [makePlant('A', 'coal'), makePlant('B', 'coal'), makePlant('C', 'gas')],
      nextId: 3, unlocked, research: {}, exp: {},  // research[id] = months left; exp[tech] = months in operation
      demandMult: 1, demandMonths: 0, gasMult: 1, gasMonths: 0, gasIndex: 1,
      pending: null, flash: null, flashN: 0, seen: {}, fails: 0, blackouts: 0,
      news: [{ m: 0, kind: 'info', text: 'You run the power utility of Capture City. Keep the lights on until 2050 and stay under the CO\u2082 limit.' }],
      last: null, techUsed: {},
    };
  }

  function year(state) { return START_YEAR + Math.floor(state.m / 12); }
  function monthName(state) {
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][state.m % 12];
  }
  function demand(state) { return 1150 * Math.pow(1.01, state.m / 12) * state.demandMult; }
  function addNews(state, kind, text) {
    state.news.unshift({ m: state.m, kind, text });
    if (state.news.length > 30) state.news.pop();
  }
  function flash(state, kind, text) {
    state.flashN += 1;
    state.flash = { n: state.flashN, kind, text };
  }
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const findPlant = (state, id) => state.plants.find(x => x.id === id);

  // ---- player actions -------------------------------------------------------
  function canInstall(state, plant, techId) {
    if (!state.unlocked[techId]) return { ok: false, why: 'Research it first' };
    if (plant.build) return { ok: false, why: 'Construction in progress' };
    if (plant.tech === techId) return { ok: false, why: 'Already installed' };
    const cost = installCost(state, plant, techId);
    if (state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost, months: installMonths(plant) };
  }
  function install(state, plantId, techId) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canInstall(state, p, techId);
    if (!chk.ok) return chk;
    state.funds -= chk.cost;
    p.build = { kind: 'tech', tech: techId, deep: false, left: chk.months, total: chk.months };
    addNews(state, 'build', `${p.name}: ${TECHS[techId].short} capture construction started ($${chk.cost}M).`);
    return chk;
  }
  function canUpgrade(state, plant) {
    if (!plant.tech) return { ok: false, why: 'Add capture first' };
    if (plant.deep) return { ok: false, why: 'Already at 99 %' };
    if (plant.build) return { ok: false, why: 'Construction in progress' };
    const cost = upgradeCost(state, plant);
    if (state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost, months: DEEP.months };
  }
  function upgrade(state, plantId) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canUpgrade(state, p);
    if (!chk.ok) return chk;
    state.funds -= chk.cost;
    p.build = { kind: 'deep', tech: p.tech, deep: true, left: DEEP.months, total: DEEP.months };
    addNews(state, 'build', `${p.name}: 99 % capture upgrade started ($${chk.cost}M).`);
    return chk;
  }
  function canConvert(state, plant) {
    const to = plant.type === 'coal' ? 'gas' : 'coal';
    const c = CONVERT[to];
    if (plant.build) return { ok: false, why: 'Construction in progress', to };
    if (state.funds < c.cost) return { ok: false, why: 'Not enough funds', to, cost: c.cost };
    return { ok: true, to, cost: c.cost, months: c.months };
  }
  function convert(state, plantId) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canConvert(state, p);
    if (!chk.ok) return chk;
    state.funds -= chk.cost;
    p.build = { kind: 'convert', toType: chk.to, left: chk.months, total: chk.months };
    addNews(state, 'build', `${p.name}: conversion to ${chk.to} started ($${chk.cost}M, offline ${chk.months} months).`);
    return chk;
  }
  function canBuildPlant(state, type) {
    const b = PLANT_TYPES[type].build;
    if (state.plants.length >= MAX_PLANTS) return { ok: false, why: `Maximum ${MAX_PLANTS} plants` };
    if (state.funds < b.cost) return { ok: false, why: 'Not enough funds', cost: b.cost };
    return { ok: true, cost: b.cost, months: b.months };
  }
  function buildPlant(state, type) {
    const chk = canBuildPlant(state, type);
    if (!chk.ok) return chk;
    const id = String.fromCharCode(65 + state.nextId);   // D, E, F \u2026
    state.nextId += 1;
    const p = makePlant(id, type);
    p.build = { kind: 'new', left: chk.months, total: chk.months };
    state.plants.push(p);
    state.funds -= chk.cost;
    addNews(state, 'build', `${p.name} under construction ($${chk.cost}M, ${chk.months} months).`);
    return Object.assign({ id }, chk);
  }
  function canDemolish(state, plant) {
    if (state.plants.length <= 1) return { ok: false, why: 'You need at least one plant' };
    if (state.funds < DEMOLISH_COST) return { ok: false, why: 'Not enough funds' };
    return { ok: true, cost: DEMOLISH_COST };
  }
  function demolish(state, plantId) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canDemolish(state, p);
    if (!chk.ok) return chk;
    state.funds -= DEMOLISH_COST;
    state.plants = state.plants.filter(x => x !== p);
    addNews(state, 'build', `${p.name} demolished ($${DEMOLISH_COST}M).`);
    return chk;
  }
  function canResearch(state, id) {
    if (state.unlocked[id] || state.research[id] != null) return { ok: false, why: 'Already done' };
    if (Object.keys(state.research).length) return { ok: false, why: 'Lab busy: one project at a time' };
    const cost = researchCost(state, id);
    if (state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost };
  }
  function startResearch(state, id) {
    const chk = canResearch(state, id);
    if (!chk.ok) return chk;
    const pr = project(id);
    state.funds -= chk.cost;
    state.research[id] = researchMonths(state, id);
    addNews(state, 'lab', `Lab research on ${pr.short} funded ($${chk.cost}M, ${state.research[id]} months).`);
    return chk;
  }
  function setPrice(state, price) { state.price = Math.max(40, Math.min(220, Math.round(price))); }

  // ---- events -----------------------------------------------------------------
  const CFG = { P_CHOICE: 0.022, P_FORCED: 0.024 };
  function capturing(state) {
    return state.plants.filter(p => p.tech && online(p) && p.outage <= 0);
  }
  function offCost(state, months) {
    const L = state.last;
    if (!L) return { extra: 0, rise: 0 };
    const extra = L.captured / 1e6 * months;                          // Mt no longer captured
    const monthly = (L.emitted + L.captured) / 1e6;                   // Mt/month with capture off
    const rise = Math.min(100, breachStep(monthly / (limit(state) / 12)) * months);
    return { extra, rise: Math.max(0, rise) };
  }
  function offText(state, months) {
    const o = offCost(state, months);
    return `\u2248 +${f1(o.extra)} Mt CO\u2082, ` + (o.rise > 0.5 ? `breach meter +${Math.round(o.rise)} %` : 'still under the limit');
  }
  function offerChoice(state, R) {
    const cap = capturing(state);
    const amine = cap.filter(p => !p.washed);
    const up = state.plants.filter(online);
    const pool = [];
    if (up.length) pool.push('heat', 'typhoon');
    if (cap.length && state.captureOff <= 0 && (state.seen.storage || 0) < 2) pool.push('storage');
    if (amine.length && !state.seen.wash) pool.push('wash');
    if (!pool.length) return;
    const id = pool[Math.floor(R() * pool.length)];
    state.seen[id] = (state.seen[id] || 0) + 1;
    if (id === 'heat') {
      state.demandMult = 1.12; state.demandMonths = 3;
      if (!cap.length || state.captureOff > 0) {
        addNews(state, 'event', 'Heat wave! Air-conditioners push demand up 12 % for 3 months.');
        flash(state, 'event', 'Heat wave! Demand +12 % for 3 months.');
        return;
      }
      const mw = cap.reduce((a, p) => a + p.gross * penalty(p, p.tech), 0);
      state.pending = {
        id, title: 'Heat wave!', text: 'Air-conditioners push demand up 12 % for 3 months. Capture eats steam that could make power.',
        opts: [
          { label: 'Pause capture for 3 months', effect: `+${Math.round(mw)} MW \u00b7 ${offText(state, 3)}` },
          { label: 'Keep capturing', effect: 'Risk blackouts' },
        ],
      };
    } else if (id === 'storage') {
      state.pending = {
        id, title: 'Protest at the CO\u2082 storage site', text: 'Residents near the injection wells demand that the storage site close for a safety review.',
        opts: [
          { label: 'Ignore them', effect: 'Public anger +20' },
          { label: 'Accept the review', effect: `All capture off 6 months (no carbon tax meanwhile) \u00b7 ${offText(state, 6)}` },
        ],
      };
    } else if (id === 'wash') {
      state.pending = {
        id, title: 'Amine emissions study', text: 'A university study finds traces of amine degradation products downwind of the capture plants.',
        opts: [
          { label: 'Install water-wash sections', effect: `$${20 * amine.length}M for ${amine.length} plant${amine.length > 1 ? 's' : ''}` },
          { label: 'Dismiss the study', effect: 'Public anger +12' },
        ],
      };
    } else {
      const p = up[Math.floor(R() * up.length)];
      state.pending = {
        id, plant: p.id, title: `Typhoon hits ${p.name}`, text: `High winds damaged ${p.name}. It produces nothing until it is repaired (\u2212${p.gross} MW).`,
        opts: [
          { label: 'Emergency repair', effect: '$60M \u00b7 back in 1 month' },
          { label: 'Standard repair', effect: 'Free \u00b7 offline 4 months' },
        ],
      };
    }
  }
  function choose(state, i) {
    const ev = state.pending;
    if (!ev) return;
    state.pending = null;
    if (ev.id === 'heat') {
      if (i === 0) { state.captureOff = 3; state.captureOffWhy = 'heat-wave pause'; addNews(state, 'event', 'Heat wave: capture paused for 3 months to keep the lights on.'); }
      else addNews(state, 'event', 'Heat wave: capture stays on. Hope the grid holds.');
    } else if (ev.id === 'storage') {
      if (i === 0) { state.anger = Math.min(100, state.anger + 20); addNews(state, 'event', 'You ignored the storage-site protest. Public anger +20.'); }
      else { state.captureOff = 6; state.captureOffWhy = 'storage-site review'; addNews(state, 'event', 'Storage site closed for review: all capture off for 6 months.'); }
    } else if (ev.id === 'wash') {
      if (i === 0) {
        const am = capturing(state).filter(p => !p.washed);
        state.funds -= 20 * am.length; am.forEach(p => { p.washed = true; });
        addNews(state, 'build', `Water-wash sections installed on ${am.length} plant${am.length > 1 ? 's' : ''} ($${20 * am.length}M).`);
      } else { state.anger = Math.min(100, state.anger + 12); addNews(state, 'event', 'You dismissed the amine study. Public anger +12.'); }
    } else if (ev.id === 'typhoon') {
      const p = findPlant(state, ev.plant);
      if (!p) return;
      if (i === 0) { state.funds -= 60; p.down = 1; p.downWhy = 'typhoon repair'; addNews(state, 'event', `${p.name}: emergency typhoon repair ($60M), back next month.`); }
      else { p.down = 4; p.downWhy = 'typhoon repair'; addNews(state, 'event', `${p.name}: standard typhoon repair, offline 4 months.`); }
    }
  }
  function forcedEvent(state, R) {
    const hasGas = state.plants.some(p => p.type === 'gas' && online(p));
    const pool = ['subsidy'];
    if (hasGas) pool.push('gas', 'lng', 'lng');
    if (state.rate > 6) pool.push('health');
    if (!state.usCut && state.m >= 18) pool.push('uscut');
    const k = pool[Math.floor(R() * pool.length)];
    if (k === 'gas') {
      state.gasMult = 1.8; state.gasMonths = 6;
      addNews(state, 'event', 'Gas price spike: gas fuel costs 80 % more for 6 months.');
      flash(state, 'event', 'Gas price spike: gas fuel +80 % for 6 months.');
    } else if (k === 'lng') {
      state.lngCut = 2;
      addNews(state, 'event', 'LNG tanker delayed and storage is only days deep: gas plants run at half power for 2 months.');
      flash(state, 'event', 'LNG shortage: gas plants at 50 % for 2 months.');
    } else if (k === 'subsidy') {
      state.subsidy = 12;
      addNews(state, 'good', 'Government CCUS subsidy: capture projects cost 30 % less for 12 months.');
      flash(state, 'good', 'CCUS subsidy: capture projects \u221230 % for 12 months.');
    } else if (k === 'health') {
      state.anger = Math.min(100, state.anger + 8);
      addNews(state, 'event', 'Health report links smog to asthma. Public anger +8.');
      flash(state, 'event', 'Health report links smog to asthma. Anger +8.');
    } else {
      state.usCut = true; state.resCut = 24;
      addNews(state, 'policy', 'Washington halts federal carbon-capture funding. Research partners pull out: lab projects cost 50 % more for 2 years.');
      flash(state, 'policy', 'US carbon-capture funding cut: research costs +50 % for 2 years.');
    }
  }

  // ---- one month --------------------------------------------------------------
  function step(state) {
    if (state.over || state.pending) return state;
    const R = rng(state.seed + state.m * 7919);
    const y = year(state);

    // scheduled news
    if (state.m === 36) addNews(state, 'policy', 'Parliament passes a carbon tax: $50 per tonne from 2030, rising $5 every year.');
    if (y >= 2030 && state.m % 12 === 0) {
      addNews(state, 'policy', `${y}: carbon tax $${carbonTax(y)}/t, CO\u2082 limit ${f1(limitAt(y))} Mt/yr and falling.`);
    }

    // gas market drifts every month (imported LNG)
    state.gasIndex = Math.max(0.8, Math.min(1.5, state.gasIndex + 0.2 * (1 - state.gasIndex) + (R() - 0.5) * 0.16));

    // research progress
    for (const id of Object.keys(state.research)) {
      state.research[id] -= 1;
      if (state.research[id] <= 0) {
        delete state.research[id];
        state.unlocked[id] = true;
        const pr = project(id);
        if (id === 'screen') addNews(state, 'lab', 'QM + MD screening is running: solvent research is 30 % faster and start-ups fail half as often.');
        else addNews(state, 'lab', `Breakthrough! ${pr.name} is ready to install.`);
        flash(state, 'lab', `Research done: ${pr.name}.`);
      }
    }
    // construction progress
    for (const p of state.plants) {
      if (!p.build) continue;
      p.build.left -= 1;
      if (p.build.left > 0) continue;
      const b = p.build;
      p.build = null;
      if (b.kind === 'new') {
        addNews(state, 'build', `${p.name} is online (+${p.gross} MW).`);
      } else if (b.kind === 'convert') {
        p.type = b.toType; p.gross = PLANT_TYPES[b.toType].size;
        p.name = `${PLANT_TYPES[b.toType].label} Plant ${p.id}`;
        addNews(state, 'build', `${p.name}: conversion finished (${p.gross} MW ${b.toType}).`);
      } else {
        if (p.tech !== b.tech) p.washed = false;
        p.tech = b.tech; p.deep = !!b.deep;
        state.techUsed[p.tech] = true;
        addNews(state, 'build', `${p.name}: ${TECHS[p.tech].short}${p.deep ? ' at 99 %' : ''} capture is online.`);
      }
    }
    // start-up failures and precipitation
    for (const p of state.plants) {
      if (p.outage > 0) { p.outage -= 1; continue; }
      if (!p.tech || !online(p)) continue;
      const t = TECHS[p.tech];
      const mat = maturity(state, p.tech);
      if (mat.risk > 0 && R() < mat.risk) {
        p.outage = 3; p.outageWhy = 'start-up failure'; p.down = 1; p.downWhy = 'tripped';
        state.funds -= 15; state.fails += 1;
        addNews(state, 'event', `${p.name}: ${t.short} start-up failure, ${t.fail}. Plant tripped for a month, capture off 3 months, repair $15M (${mat.exp}/${PROVEN_MONTHS} months of experience).`);
        flash(state, 'event', `${p.name}: ${t.short} start-up failure, ${t.fail}.`);
      } else if (t.risk && R() < t.risk) {
        p.outage = 2; p.outageWhy = 'precipitation';
        addNews(state, 'event', `${p.name}: AMP carbamate precipitated, capture off for 2 months.`);
        flash(state, 'event', `${p.name}: solvent precipitation, capture off 2 months.`);
      }
    }

    // dispatch: cheapest net MWh first
    const tax = (state.captureOff > 0 && state.captureOffWhy === 'storage-site review') ? 0 : carbonTax(y);
    const units = state.plants.filter(online).map(p => {
      const pt = PLANT_TYPES[p.type];
      const on = p.tech && p.outage <= 0 && state.captureOff <= 0;
      const e = on ? eff(p.tech, p.deep, p.type) : null;
      const c = e ? e.capture : 0;
      const pen = e ? pt.intensity * c * workPerTonne(e) : 0;
      const fuel = p.type === 'gas' ? gasFuel(state) : pt.fuel;
      const avail = p.type === 'gas' && state.lngCut > 0 ? 0.5 : 1;
      const perGross = fuel + (e ? e.opex * pt.intensity * c : 0) + tax * pt.intensity * (1 - c);
      return { p, pt, e, c, pen, netCap: p.gross * avail * (1 - pen), marginal: perGross / (1 - pen), fuel };
    }).sort((a, b) => a.marginal - b.marginal);

    const D = demand(state);
    let left = D, revenue = 0, cost = 0, emitted = 0, captured = 0, served = 0, netCapTotal = 0;
    for (const u of units) {
      netCapTotal += u.netCap;
      const run = Math.min(u.netCap, left);
      left -= run;
      const netMWh = run * HOURS;
      const grossMWh = netMWh / (1 - u.pen);
      const co2 = grossMWh * u.pt.intensity;           // t
      const cap = co2 * u.c, emi = co2 - cap;
      emitted += emi; captured += cap; served += netMWh;
      cost += grossMWh * u.fuel + (u.e ? cap * u.e.opex : 0) + emi * tax;
      u.run = run;
    }
    for (const p of state.plants) cost += p.gross * PLANT_TYPES[p.type].fixed * 1e6;   // fixed O&M, running or not
    revenue = served * state.price;
    const overhead = 25e6;                              // grid, staff, maintenance
    const profit = (revenue - cost - overhead) / 1e6;   // $M
    state.funds += profit;

    // technology experience (a solvent is proven after 24 months in operation)
    const seen = {};
    for (const p of state.plants) if (p.tech && online(p)) seen[p.tech] = true;
    for (const id of Object.keys(seen)) {
      state.exp[id] = (state.exp[id] || 0) + 1;
      if (TECHS[id].startup && state.exp[id] === PROVEN_MONTHS) {
        addNews(state, 'good', `${TECHS[id].name} is now proven: no more start-up failures.`);
        flash(state, 'good', `${TECHS[id].short} is proven after 2 years: no more start-up failures.`);
      }
    }

    // CO2 accounting against the shrinking limit
    const unservedFrac = Math.max(0, left) / D;
    const monthMt = emitted / 1e6;
    state.cumCO2 += monthMt;                            // Mt
    state.captured += captured / 1e6;
    state.recent.push(monthMt);
    if (state.recent.length > 3) state.recent.shift();
    state.rate = state.recent.reduce((a, b) => a + b, 0) / state.recent.length * 12;   // Mt/yr, 3-month average
    const lim = limit(state);
    const allow = lim / 12;
    state.greenhouse = Math.max(0, Math.min(100, state.greenhouse + breachStep(monthMt / allow)));
    if (monthMt > allow) {
      state.overMonths += 1;
      if (!state.wasOver) {
        state.wasOver = true;
        addNews(state, 'event', `Over the CO\u2082 limit (${f1(lim)} Mt/yr)! The breach meter is rising.`);
        flash(state, 'event', 'Over the CO\u2082 limit! The breach meter is rising (100 % = game over).');
      }
    } else {
      state.wasOver = false;
    }
    state.maxDebt = Math.max(state.maxDebt, state.greenhouse);       // worst breach, %

    const baseRate = 1150 * HOURS * 0.95;               // t/month if all-coal, no capture
    const smog = emitted / baseRate;
    let dA = 7 * Math.max(0, (state.price - FAIR_PRICE) / FAIR_PRICE)
           + 40 * unservedFrac
           + 1.2 * smog
           + 0.02 * state.greenhouse
           - 1.0;
    if (state.price < FAIR_PRICE) dA -= 0.8 * (FAIR_PRICE - state.price) / FAIR_PRICE;
    state.anger = Math.max(0, Math.min(100, state.anger + dA));
    if (unservedFrac > 0.02) { state.blackouts += 1; addNews(state, 'event', `Blackouts: ${Math.round(unservedFrac * 100)} % of demand unserved!`); }

    // timers
    if (state.demandMonths > 0 && --state.demandMonths === 0) state.demandMult = 1;
    if (state.gasMonths > 0 && --state.gasMonths === 0) state.gasMult = 1;
    if (state.subsidy > 0) state.subsidy -= 1;
    if (state.resCut > 0) state.resCut -= 1;
    if (state.lngCut > 0 && --state.lngCut === 0) addNews(state, 'good', 'LNG supply is back to normal.');
    if (state.captureOff > 0 && --state.captureOff === 0) addNews(state, 'good', 'Capture is back on.');
    for (const p of state.plants) if (p.down > 0 && --p.down === 0) addNews(state, 'good', `${p.name} is running again.`);

    state.last = {
      demand: D, netCap: netCapTotal, served: served / HOURS, unservedFrac, emitted, captured, limit: lim,
      revenue: revenue / 1e6, cost: cost / 1e6 + overhead / 1e6, profit, tax, gasFuel: gasFuel(state),
      units: units.map(u => ({ id: u.p.id, run: u.run, netCap: u.netCap, pen: u.pen, c: u.c })),
    };

    state.m += 1;
    if (state.greenhouse >= 100) state.over = { win: false, why: 'greenhouse' };
    else if (state.anger >= 100) state.over = { win: false, why: 'anger' };
    else if (state.funds < BANKRUPT) state.over = { win: false, why: 'bankrupt' };
    else if (state.m >= MONTHS) state.over = { win: true, why: 'survived' };

    // random events for next month (a choice pauses the game until answered)
    if (!state.over && state.m > 6) {
      const r = R();
      if (r < CFG.P_CHOICE) offerChoice(state, R);
      else if (r < CFG.P_CHOICE + CFG.P_FORCED) forcedEvent(state, R);
    }
    return state;
  }

  // ---- score --------------------------------------------------------------------
  const STARS = { three: 2600, two: 2300 };   // sim_test.js with events: MEA+99 \u2248 2\u2605, planned 2PE routes \u2248 2\u20133\u2605
  function score(s) {
    return Math.round(Math.max(0, 250 - s.cumCO2) * 6 + (100 - s.anger) * 5 + Math.max(0, s.funds) * 0.5 + s.captured * 1.5);
  }
  function stars(s) {
    if (!s.over || !s.over.win) return 0;
    const sc = score(s);
    return sc >= STARS.three ? 3 : sc >= STARS.two ? 2 : 1;
  }

  const api = {
    HOURS, MONTHS, START_YEAR, END_YEAR, FAIR_PRICE, BANKRUPT, MAX_PLANTS, DEMOLISH_COST, LIMIT_POINTS, LIMIT_SCALE,
    BREACH, breachStep, PROVEN_MONTHS, DEEP, PLANT_TYPES, CONVERT, TECHS, TECH_ORDER, PROJECTS, LAB_ORDER, CFG, STARS,
    newGame, step, choose, offCost, online,
    install, canInstall, installCost, installMonths, upgrade, canUpgrade, upgradeCost,
    convert, canConvert, buildPlant, canBuildPlant, demolish, canDemolish,
    startResearch, canResearch, researchCost, researchMonths, project, maturity,
    setPrice, penalty, eff, workPerTonne, carbonTax, limit, limitAt, gasFuel, demand, year, monthName, score, stars,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
