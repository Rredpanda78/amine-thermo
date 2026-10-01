/* Capture City 2050 \u2014 game model v6 (pure logic, no DOM).
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
 *   PZ + advanced stripper 2.45 GJ/t .. Suresh Babu & Rochelle, Int. J. Greenh. Gas Control 2021 (net, 90 % capture,
 *                                       same at 4 % and 12 % CO2); stripper pilot: Lin, Chen & Rochelle, Faraday Discuss. 2016
 *
 * Game rules that are NOT from papers: plant sizes and prices, fuel prices, the CO2 limit path,
 * event odds, start-up failure odds, research costs and times, the gas-capture penalty,
 * and the three regions (simplified settings inspired by Taiwan, Norway and Texas, not forecasts).
 * Monthly demand shapes follow the usual seasonal pattern of each grid (Taiwan: summer air-conditioning peak;
 * Norway: winter electric-heating peak; Texas/ERCOT: strong summer peak, smaller winter peak), rounded.
 */
(function (root) {
  'use strict';

  const HOURS = 730;                 // hours per month
  const GJ_TO_MWH_E = 0.069;          // steam heat -> lost electricity (0.25 equivalent-work factor)
  const COMPRESS = 0.10;              // MWh_e per t CO2 for compression + pumps
  const START_YEAR = 2026, END_YEAR = 2050;
  const MONTHS = (END_YEAR - START_YEAR + 1) * 12;   // Jan 2026 .. Dec 2050
  const FAIR_PRICE = 100;             // $/MWh the public accepts (Taiwan; each region sets its own)
  // Regions: what people accept to pay, demand growth, fuel, carbon price or credit, the limit, grid links, hazards
  const REGIONS = {
    taiwan: {
      label: 'Taiwan', hint: 'standard', stars: [2500, 3000], base: 1150, peak: 'heat', fair: 100, growth: 0.02, gas: 50, gasSwing: 0.16, tax: { from: 2030, base: 30, step: 4 },
      credit: 0, limitMul: 1.0, imports: 0, wholesale: 70, typhoon: true, lng: true, winter: false, heat: 1,
      blurb: 'Island grid, no imports. Gas arrives as LNG by ship and storage is only days deep. Typhoons. A carbon fee starts in 2030.',
    },
    norway: {
      label: 'Norway', hint: 'easier', stars: [2900, 3150], base: 1250, fair: 120, growth: 0.01, gas: 45, gasSwing: 0.24, tax: { from: 2027, base: 60, step: 4 },
      credit: 0, capexMul: 0.75, limitMul: 0.85, imports: 300, wholesale: 75, typhoon: false, lng: false, winter: false, heat: 1, peak: 'cold',
      blurb: 'Home of offshore CO\u2082 storage and a high CO\u2082 tax. The state pays a quarter of every capture unit (like Longship). Electric heating makes winter the peak; Nordic neighbours lend up to 300 MW.',
    },
    texas: {
      label: 'Texas', hint: 'harder', stars: [3150, 3450], base: 1300, peak: 'heat', fair: 75, growth: 0.022, gas: 28, gasSwing: 0.2, tax: null,
      credit: 15, limitMul: 1.15, imports: 0, wholesale: 55, typhoon: false, lng: false, winter: true, heat: 2,
      blurb: 'No carbon tax: a federal credit pays $15 for every tonne you store (like the US 45Q credit). Cheap shale gas, low prices, fast demand growth, heat waves and winter storms. Its grid is an island too.',
    },
  };
  const RG = state => REGIONS[state.region] || REGIONS.taiwan;
  // monthly demand shape (Jan..Dec, mean 1): the usual seasonal swing of each grid, rounded
  const SEASON = (() => {
    const raw = {
      taiwan: [0.90, 0.86, 0.93, 0.95, 1.02, 1.08, 1.15, 1.15, 1.08, 1.00, 0.95, 0.93],
      norway: [1.30, 1.25, 1.15, 1.00, 0.88, 0.80, 0.78, 0.80, 0.88, 1.00, 1.12, 1.24],
      texas:  [0.97, 0.90, 0.88, 0.88, 0.98, 1.10, 1.20, 1.22, 1.08, 0.95, 0.90, 0.95],
    };
    const out = {};
    for (const [k, v] of Object.entries(raw)) { const m = v.reduce((a, b) => a + b, 0) / 12; out[k] = v.map(x => x / m); }
    return out;
  })();
  const seasonOf = state => (SEASON[state.region] || SEASON.taiwan)[state.m % 12];
  const peakSeason = state => Math.max(...(SEASON[state.region] || SEASON.taiwan));
  const SURPLUS_SHARE = 0.25;         // industrial / wholesale buyers take up to 25 % of demand at the wholesale price
  const BANKRUPT = -500;              // $M
  const MAX_PLANTS = 10;
  const DEMOLISH_COST = 30;           // $M

  // Legal CO2 limit (Mt per year). It tightens every year toward net zero in 2050.
  const LIMIT_POINTS = [[2026, 10.5], [2028, 9.8], [2030, 8.5], [2035, 5.5], [2040, 2.5], [2045, 1.1], [2050, 0.6]];
  const LIMIT_SCALE = 12;             // meter full scale (Mt/yr)
  // breach meter (0-100 %): rises with how far over the limit you are, falls slowly while you stay under it
  const BREACH = { up: 10, down: 5, maxStep: 8 };    // % per month per 100 % over / under the limit (max +8 %/month)
  const PROVEN_MONTHS = 24;           // months of operation before a new solvent stops failing
  const SCREEN_TIME = 0.7, SCREEN_RISK = 0.5;   // QM+MD screening: research time and start-up risk factors
  const DEEP = { capture: 0.99, dutyMul: 1.09, opexAdd: 1, costFrac: 0.7, months: 12 };   // a costly, slow last resort

  // capexFactor: capture-unit cost per MW relative to coal; dutyMul/opexMul: dilute flue gas costs more per tonne
  const PLANT_TYPES = {
    coal: { label: 'Coal', intensity: 0.95, fuel: 30, fixed: 0.0030, capexFactor: 1.0, dutyMul: 1.0, opexMul: 1.0,
      size: 600, build: { cost: 900, months: 24 } },
    gas:  { label: 'Gas',  intensity: 0.37, fuel: 50, fixed: 0.0020, capexFactor: 0.75, dutyMul: 1.15, opexMul: 1.2,
      size: 400, build: { cost: 420, months: 12 } },
  };
  const CONVERT = { gas: { cost: 200, months: 4 }, coal: { cost: 450, months: 18 } };   // keyed by the new fuel

  // capture: fraction captured; duty: regeneration GJ/t; capex: $M per MW gross (coal basis); opex: $/t captured
  // rate: CO2 absorption speed relative to MEA. Build cost = half absorber + half the rest; packed height goes
  // roughly as 1/sqrt(rate) (fast pseudo-first-order regime), floored at 0.5 because the tower still needs gas contact
  // and a water wash. The rest: advanced stripper 1.3, viscous 2PE-EG 1.1 (bigger pumps and exchangers), else 1.0.
  // stage: how far the technology has been scaled up; startup: monthly failure odds until proven; risk: forever
  const TECHS = {
    mea90: {
      name: 'MEA', short: 'MEA', capture: 0.90, duty: 3.5, capex: 1.00, opex: 10, rate: 1,
      unlocked: true, color: '#5B8DEF', stage: 'Commercial', startup: 0,
      pitch: 'Proven and available now, but uses the most steam.',
      fact: '30 wt% MEA, the industry benchmark. Regeneration \u2248 3.5 GJ per tonne CO\u2082.',
      src: 'Chen, Wu & Lin, Chem. Eng. J. 2026',
    },
    afs: {
      name: 'MEA + advanced stripper', short: 'MEA-AS', capture: 0.90, duty: 2.8, capex: 1.15, opex: 10, rate: 1,
      unlocked: false, research: { cost: 80, months: 12, process: true }, color: '#2BB3C0', stage: 'Pilot-tested', startup: 0.012,
      fail: 'the new stripper would not hold steady',
      pitch: 'Same MEA, smarter heat recovery: less steam, safe bet, pricier to build.',
      fact: 'A heat-integrated stripper cuts MEA regeneration to \u2248 2.8 GJ/t.',
      src: 'Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025',
    },
    ampnmp: {
      name: 'AMP\u2013NMP (semi-aqueous)', short: 'AMP-NMP', capture: 0.90, duty: 3.0, capex: 1.45, opex: 6, rate: 0.3,
      unlocked: false, research: { cost: 100, months: 18, exp: 0.9, comp: 0.6 }, color: '#0E9F6E', est: ['duty', 'opex', 'capex'], stage: 'Lab scale',
      startup: 0.025, risk: 0.006, solvent: true, fail: 'AMP carbamate precipitated and clogged a line',
      pitch: 'Cheapest to run, but it absorbs slowly: the tallest absorber, the priciest to build, and it can clog.',
      fact: 'NMP does not react with CO\u2082; it makes the hindered amine AMP 3\u00d7 faster than in water, and AMP holds about twice the CO\u2082 of MEA, so only half the solvent has to circulate: smaller pumps and less make-up, the cheapest to run. Catch: AMP carbamate can precipitate at high loading and clog lines, even years after start-up.',
      src: 'Cheng, Chen & Lin, Chem. Eng. J. 2025',
    },
    pe2eg: {
      name: '2PE\u2013EG (water-lean)', short: '2PE-EG', capture: 0.90, duty: 2.9, capex: 0.80, opex: 9, rate: 4.5,
      unlocked: false, research: { cost: 180, months: 24, exp: 0.85, comp: 0.5 }, color: '#E2A93B', est: ['capex'], star: true, stage: 'Lab scale',
      startup: 0.035, solvent: true, fail: 'the viscous solvent overloaded the heat exchanger',
      pitch: 'The rarest find and shaky first years, then fast, compact and efficient: the best all-rounder.',
      fact: 'Ethylene glycol reacts: it turns the carbamate into alkyl carbonate and frees the amine again, so 2-piperidineethanol gets both 4.5\u00d7 faster reaction and 2.8\u00d7 cyclic capacity vs MEA; regeneration 128 kJ/mol (\u2248 2.9 GJ/t). Catch: 15\u00d7 more viscous than MEA.',
      src: 'Chen, Wu & Lin, Chem. Eng. J. 2026',
    },
  };
  TECHS.pz = {
    name: 'Piperazine (PZ) + advanced stripper', short: 'PZ', capture: 0.90, duty: 2.45, capex: 0.90, opex: 11, rate: 9.5,
    unlocked: false, research: { cost: 90, months: 18, exp: 0.95, comp: 0.7 }, color: '#8E7CC3', est: ['capex', 'opex'],
    stage: 'Pilot-tested', startup: 0.015, risk: 0.003, gasOK: true, solvent: true, fail: 'solid piperazine froze out in a cold line',
    pitch: 'Least steam in pilot plants, even on dilute gas-plant flue gas, and so fast the absorber is short; PZ is costly to buy and can freeze out when cold.',
    fact: 'Piperazine is the second-generation benchmark: fast, thermally stable, high capacity. With the advanced stripper, pilot plants measured a net 2.45 GJ per tonne CO\u2082 at 90 % capture, the same at 4 % (gas) and 12 % (coal) CO\u2082. Prof. Yu-Jeng Lin pilot-tested this stripper during his PhD. Catch: solid PZ can precipitate if the solvent gets too cold.',
    src: 'Suresh Babu & Rochelle, Int. J. Greenh. Gas Control 2021; Lin, Chen & Rochelle, Faraday Discuss. 2016',
  };
  const TECH_ORDER = ['mea90', 'afs', 'pz', 'ampnmp', 'pe2eg'];
  // how a new solvent is found: lab experiments (slow, likely to work) or computer screening (fast, riskier)
  // Solvent screening: each campaign discovers ONE random solvent you do not have yet (rarer = better/newer).
  // Lab experiments are slow but usually find something; computer screening (QM + MD) is fast and cheap but can come
  // up empty, and every empty screen teaches the next one.
  const METHODS = {
    exp: { label: 'Lab experiments', cost: 120, months: 18, odds: 0.9 },
    comp: { label: 'Computer screening (QM + MD)', cost: 50, months: 6, odds: 0.5, learn: 0.15 },
  };
  const DROPS = { pz: { weight: 40, stars: 3 }, ampnmp: { weight: 35, stars: 3 }, pe2eg: { weight: 25, stars: 4 } };

  // research projects that are not a capture technology
  const PROJECTS = {};
  const LAB_ORDER = ['screen', 'afs'];   // one screening campaign or the advanced-stripper pilot, one at a time

  // ---- technology helpers -----------------------------------------------------
  function eff(techId, deep, type) {
    const t = TECHS[techId];
    if (!t) return null;
    const pt = PLANT_TYPES[type || 'coal'];
    const e = { capture: t.capture, duty: t.duty, opex: t.opex };
    if (deep) { e.capture = DEEP.capture; e.duty *= DEEP.dutyMul; e.opex += DEEP.opexAdd; }
    if (!t.gasOK) e.duty *= pt.dutyMul;   // PZ + advanced stripper performs the same on dilute gas-plant flue gas
    e.opex *= pt.opexMul;
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
    c *= RG(state).capexMul || 1;
    return Math.round(c);
  }
  function installMonths(plant) { return plant.tech ? 3 : 9; }
  function upgradeCost(state, plant) {
    let c = (TECHS[plant.tech].deepEasy ? 0.45 : DEEP.costFrac) * capexFull(plant, plant.tech);
    if (state.subsidy > 0) c *= 0.7;
    c *= RG(state).capexMul || 1;
    return Math.round(c);
  }
  function taxFor(region, year) {
    const t = (REGIONS[region] || REGIONS.taiwan).tax;
    return !t || year < t.from ? 0 : t.base + t.step * (year - t.from);
  }
  function carbonTax(year, state) { return taxFor(state ? state.region : 'taiwan', year); }
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
  function limitFor(state, t) { return limitAt(t) * RG(state).limitMul; }
  function limit(state) { return limitFor(state, START_YEAR + Math.min(state.m, MONTHS - 1) / 12); }
  function fairPrice(state) { return RG(state).fair; }
  // monthly change of the breach meter for emissions at `ratio` \u00d7 the allowed rate
  function breachStep(ratio) {
    return ratio > 1 ? Math.min(BREACH.maxStep, BREACH.up * (ratio - 1)) : -BREACH.down * (1 - ratio);
  }
  function gasFuel(state) { return RG(state).gas * state.gasIndex * state.gasMult; }
  // a plant produces power unless it is being built, converted or repaired
  function online(p) { return p.down <= 0 && !(p.build && (p.build.kind === 'new' || p.build.kind === 'convert')); }

  // stage / maturity of a technology in this game
  function maturity(state, techId) {
    const t = TECHS[techId];
    const exp = state.exp[techId] || 0;
    const proven = !t.startup || exp >= PROVEN_MONTHS;
    const risk = proven ? 0 : t.startup;
    return { stage: t.stage, exp, proven, risk, needs: PROVEN_MONTHS };
  }

  // research projects: capture technologies (TECHS[id].research) and PROJECTS
  function project(id) {
    if (id === 'screen') return { id, name: 'Solvent screening', short: 'screening', cost: METHODS.exp.cost, months: METHODS.exp.months,
      desc: 'Finds one new solvent you do not have yet (rarer = better). Experiments are slow but reliable; QM + MD computer screening, like our GHGT-18 poster, is fast and cheap but can miss, and every miss improves the next.' };
    if (PROJECTS[id]) return Object.assign({ id }, PROJECTS[id]);
    const t = TECHS[id];
    return { id, name: t.name, short: t.short, cost: t.research.cost, months: t.research.months, star: t.star,
      desc: t.pitch, solvent: t.solvent, process: !!t.research.process };
  }
  const methodOf = (id, method) => id !== 'screen' ? 'exp' : (METHODS[method] ? method : 'exp');
  const undiscovered = state => Object.keys(DROPS).filter(k => !state.unlocked[k]);
  function researchCost(state, id, method) {
    const base = id === 'screen' ? METHODS[methodOf(id, method)].cost : project(id).cost;
    return Math.round(base * (state.resCut > 0 ? 1.5 : 1));
  }
  function researchMonths(state, id, method) { return id === 'screen' ? METHODS[methodOf(id, method)].months : project(id).months; }
  // chance that the project finds a working solvent (every failed computer screen teaches the next one)
  function researchOdds(state, id, method) {
    if (id !== 'screen') return 1;
    const mt = methodOf(id, method);
    const learned = mt === 'comp' ? METHODS.comp.learn * ((state.tries && state.tries.screen) || 0) : 0;
    return Math.min(0.95, METHODS[mt].odds + learned);
  }
  // draw one solvent from what is still undiscovered, weighted by rarity
  function drawSolvent(state, R) {
    const pool = undiscovered(state);
    const total = pool.reduce((a, k) => a + DROPS[k].weight, 0);
    let x = R() * total;
    for (const k of pool) { x -= DROPS[k].weight; if (x <= 0) return k; }
    return pool[pool.length - 1];
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
      tech: null, deep: false, build: null, queue: [], outage: 0, down: 0, downWhy: '', washed: false };
  }
  function newGame(seed, region) {
    region = REGIONS[region] ? region : 'taiwan';
    const unlocked = {};
    TECH_ORDER.forEach(id => { unlocked[id] = !!TECHS[id].unlocked; });
    Object.keys(PROJECTS).forEach(id => { unlocked[id] = false; });
    return {
      seed: seed || Math.floor(Math.random() * 1e9),
      region, m: 0, funds: 700, price: REGIONS[region].fair, cumCO2: 0, captured: 0, anger: 10,
      greenhouse: 0, maxDebt: 0, rate: 0, recent: [], overMonths: 0, wasOver: false,
      over: null, subsidy: 0, resCut: 0, opexCut: 0, usCut: false, headline: null, headlineN: 0, labQueue: [], captureOff: 0, captureOffWhy: '', lngCut: 0, shipMonths: 0, gasFreeze: 0,
      warnedYear: 0, sold: 0, soldTotal: 0, imported: 0, creditPaid: 0, taxPaid: 0,
      plants: REGIONS[region].peak === 'cold' || region === 'texas'
        ? [makePlant('A', 'coal'), makePlant('B', 'coal'), makePlant('C', 'gas'), makePlant('D', 'gas')]
        : [makePlant('A', 'coal'), makePlant('B', 'coal'), makePlant('C', 'gas')],
      nextId: REGIONS[region].peak === 'cold' || region === 'texas' ? 4 : 3, unlocked, research: {}, resMethod: {}, tries: {}, exp: {},  // research[id] = months left; exp[tech] = months in operation
      demandMult: 1, demandMonths: 0, gasMult: 1, gasMonths: 0, gasIndex: 1,
      pending: null, flash: null, flashN: 0, seen: {}, fails: 0, blackouts: 0, discovery: null,
      news: [{ m: 0, kind: 'info', text: 'You run the power utility of Capture City. Keep the lights on until 2050 and stay under the CO\u2082 limit.' }],
      last: null, techUsed: {},
    };
  }

  function year(state) { return START_YEAR + Math.floor(state.m / 12); }
  function monthName(state) {
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][state.m % 12];
  }
  function trendDemand(state) { return RG(state).base * Math.pow(1 + RG(state).growth, state.m / 12); }
  function demand(state) { return trendDemand(state) * seasonOf(state) * state.demandMult; }
  function peakDemand(state) { return trendDemand(state) * peakSeason(state); }
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
  // `paid` = the job was already paid for when it was queued, so skip the funds check and the charge
  function canInstall(state, plant, techId, paid) {
    if (!state.unlocked[techId]) return { ok: false, why: 'Research it first' };
    if (plant.build) return { ok: false, why: 'Construction in progress' };
    if (plant.tech === techId) return { ok: false, why: 'Already installed' };
    const cost = installCost(state, plant, techId);
    if (!paid && state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost, months: installMonths(plant) };
  }
  function install(state, plantId, techId, paid) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canInstall(state, p, techId, paid != null);
    if (!chk.ok) return chk;
    const cost = paid != null ? paid : chk.cost;
    if (paid == null) state.funds -= cost;
    p.build = { kind: 'tech', tech: techId, deep: false, left: chk.months, total: chk.months, paid: cost };
    addNews(state, 'build', `${p.name}: ${TECHS[techId].short} capture construction started ($${cost}M).`);
    return chk;
  }
  function canUpgrade(state, plant, paid) {
    if (!plant.tech) return { ok: false, why: 'Add capture first' };
    if (plant.deep) return { ok: false, why: 'Already at 99 %' };
    if (plant.build) return { ok: false, why: 'Construction in progress' };
    const cost = upgradeCost(state, plant);
    if (!paid && state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost, months: DEEP.months };
  }
  function upgrade(state, plantId, paid) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canUpgrade(state, p, paid != null);
    if (!chk.ok) return chk;
    const cost = paid != null ? paid : chk.cost;
    if (paid == null) state.funds -= cost;
    p.build = { kind: 'deep', tech: p.tech, deep: true, left: DEEP.months, total: DEEP.months, paid: cost };
    addNews(state, 'build', `${p.name}: 99 % capture upgrade started ($${cost}M).`);
    return chk;
  }
  function canConvert(state, plant, paid) {
    const to = plant.type === 'coal' ? 'gas' : 'coal';
    const c = CONVERT[to];
    if (plant.build) return { ok: false, why: 'Construction in progress', to };
    if (!paid && state.funds < c.cost) return { ok: false, why: 'Not enough funds', to, cost: c.cost };
    return { ok: true, to, cost: c.cost, months: c.months };
  }
  function convert(state, plantId, paid) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canConvert(state, p, paid != null);
    if (!chk.ok) return chk;
    const cost = paid != null ? paid : chk.cost;
    if (paid == null) state.funds -= cost;
    p.build = { kind: 'convert', toType: chk.to, left: chk.months, total: chk.months, paid: cost };
    addNews(state, 'build', `${p.name}: conversion to ${chk.to} started ($${cost}M, offline ${chk.months} months).`);
    return chk;
  }

  // ---- work queues (like training units in a strategy game): paid when queued, refunded when cancelled ----
  const QUEUE_MAX = 5;
  const qOf = p => p.queue || (p.queue = []);
  // the plant as it will be once its current job and everything queued behind it are finished
  function planned(plant) {
    const v = { type: plant.type, gross: plant.gross, tech: plant.tech, deep: plant.deep };
    const apply = job => {
      if (!job) return;
      if (job.kind === 'tech') { v.tech = job.tech; v.deep = false; }
      else if (job.kind === 'deep') v.deep = true;
      else if (job.kind === 'convert') { v.type = job.toType; v.gross = PLANT_TYPES[job.toType].size; }
    };
    apply(plant.build);
    qOf(plant).forEach(apply);
    return v;
  }
  // what a job would cost if queued now (checked against the planned plant, not today's)
  function canQueue(state, plant, job) {
    if (plant.build && plant.build.kind === 'new') return { ok: false, why: 'Plant still being built' };
    if (qOf(plant).length >= QUEUE_MAX) return { ok: false, why: `Queue full (${QUEUE_MAX})` };
    const v = planned(plant);
    let cost, months, to;
    if (job.kind === 'tech') {
      if (!TECHS[job.tech]) return { ok: false, why: 'Unknown technology' };
      if (!state.unlocked[job.tech]) return { ok: false, why: TECHS[job.tech].solvent ? 'Find it by solvent screening' : 'Run the pilot test first' };
      if (v.tech === job.tech) return { ok: false, why: plant.tech === job.tech && !plant.build && !qOf(plant).length ? 'Already installed' : 'Already queued' };
      cost = installCost(state, v, job.tech); months = installMonths(v);
    } else if (job.kind === 'deep') {
      if (!v.tech) return { ok: false, why: 'Add capture first' };
      if (v.deep) return { ok: false, why: plant.deep && !plant.build ? 'Already at 99 %' : 'Already queued' };
      cost = upgradeCost(state, v); months = DEEP.months;
    } else if (job.kind === 'convert') {
      to = v.type === 'coal' ? 'gas' : 'coal';
      cost = CONVERT[to].cost; months = CONVERT[to].months;
    } else return { ok: false, why: 'Unknown job' };
    if (state.funds < cost) return { ok: false, why: 'Not enough funds', cost, months, to };
    return { ok: true, cost, months, to };
  }
  function enqueue(state, plantId, job) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canQueue(state, p, job);
    if (!chk.ok) return chk;
    state.funds -= chk.cost;
    const item = { kind: job.kind, tech: job.tech, toType: chk.to, paid: chk.cost, months: chk.months };
    if (!p.build && !qOf(p).length) startJob(state, p, item);
    else { qOf(p).push(item); addNews(state, 'build', `${p.name}: ${jobName(item)} queued ($${chk.cost}M paid).`); }
    return chk;
  }
  function jobName(job) {
    return job.kind === 'tech' ? `${TECHS[job.tech].short} capture` : job.kind === 'deep' ? '99 % upgrade' : `conversion to ${job.toType}`;
  }
  // start a paid job; if it no longer makes sense (e.g. a solvent swap already done) the money comes back
  function startJob(state, p, item) {
    const r = item.kind === 'tech' ? install(state, p.id, item.tech, item.paid)
      : item.kind === 'deep' ? upgrade(state, p.id, item.paid) : convert(state, p.id, item.paid);
    if (!r.ok) { state.funds += item.paid; addNews(state, 'build', `${p.name}: ${jobName(item)} skipped (${r.why.toLowerCase()}), $${item.paid}M refunded.`); }
    return r;
  }
  // index 0 = the job under way (full refund, the plant goes back to how it was); 1.. = queued jobs
  function cancelJob(state, plantId, index) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    if (index === 0) {
      if (!p.build || p.build.kind === 'new') return { ok: false, why: 'Nothing to cancel' };
      const back = p.build.paid || 0;
      state.funds += back;
      addNews(state, 'build', `${p.name}: ${jobName(p.build)} cancelled, $${back}M refunded.`);
      p.build = null;
      return { ok: true, refund: back };
    }
    const q = qOf(p);
    const item = q[index - 1];
    if (!item) return { ok: false, why: 'Nothing to cancel' };
    q.splice(index - 1, 1);
    state.funds += item.paid;
    return { ok: true, refund: item.paid };
  }

  // lab queue: the lab runs one project at a time, the rest wait (already paid)
  function canQueueResearch(state, id, method) {
    const lq = state.labQueue || (state.labQueue = []);
    if (lq.length >= QUEUE_MAX) return { ok: false, why: `Queue full (${QUEUE_MAX})` };
    if (id === 'screen') {
      const planned = lq.filter(x => x.id === 'screen').length + (state.research.screen != null ? 1 : 0);
      if (planned >= undiscovered(state).length) return { ok: false, why: undiscovered(state).length ? 'Enough screens queued' : 'Every solvent found' };
    } else {
      if (!TECHS[id] || !TECHS[id].research) return { ok: false, why: 'Nothing to research' };
      if (state.unlocked[id] || state.research[id] != null || lq.some(x => x.id === id)) return { ok: false, why: 'Already done or queued' };
    }
    const mt = methodOf(id, method);
    const cost = researchCost(state, id, mt);
    if (state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost, months: researchMonths(state, id, mt), method: mt };
  }
  function enqueueResearch(state, id, method) {
    if (!Object.keys(state.research).length && !(state.labQueue || []).length) return startResearch(state, id, method);
    const chk = canQueueResearch(state, id, method);
    if (!chk.ok) return chk;
    state.funds -= chk.cost;
    state.labQueue.push({ id, method: chk.method, paid: chk.cost, months: chk.months });
    addNews(state, 'lab', `${id === 'screen' ? METHODS[chk.method].label : project(id).name} queued ($${chk.cost}M paid).`);
    return chk;
  }
  function cancelResearch(state, index) {
    const lq = state.labQueue || [];
    const item = lq[index];
    if (!item) return { ok: false, why: 'Nothing to cancel' };
    lq.splice(index, 1);
    state.funds += item.paid;
    return { ok: true, refund: item.paid };
  }
  function startQueues(state) {
    for (const p of state.plants) {
      while (!p.build && qOf(p).length) startJob(state, p, qOf(p).shift());
    }
    const lq = state.labQueue || [];
    while (!Object.keys(state.research).length && lq.length) {
      const item = lq.shift();
      const r = startResearch(state, item.id, item.method, item.paid);
      if (!r.ok) { state.funds += item.paid; addNews(state, 'lab', `Queued lab project skipped (${r.why.toLowerCase()}), $${item.paid}M refunded.`); }
    }
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
    const back = qOf(p).reduce((a, x) => a + x.paid, 0);   // queued jobs never started: money back
    state.funds += back;
    state.plants = state.plants.filter(x => x !== p);
    addNews(state, 'build', `${p.name} demolished ($${DEMOLISH_COST}M)${back ? `, $${back}M of queued work refunded` : ''}.`);
    return chk;
  }
  function canResearch(state, id, method, paid) {
    if (id === 'screen') { if (!undiscovered(state).length) return { ok: false, why: 'Every solvent found' }; }
    else if (!TECHS[id] || !TECHS[id].research) return { ok: false, why: 'Nothing to research' };
    if (state.unlocked[id] || state.research[id] != null) return { ok: false, why: 'Already done' };
    if (Object.keys(state.research).length) return { ok: false, why: 'Lab busy: one project at a time' };
    const cost = researchCost(state, id, method);
    if (!paid && state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost };
  }
  function startResearch(state, id, method, paid) {
    const chk = canResearch(state, id, method, paid != null);
    if (!chk.ok) return chk;
    const pr = project(id), mt = methodOf(id, method);
    const cost = paid != null ? paid : chk.cost;
    if (paid == null) state.funds -= cost;
    state.research[id] = researchMonths(state, id, mt);
    state.resMethod[id] = mt;
    state.resTotal = state.research[id];
    addNews(state, 'lab', id === 'screen'
      ? `${METHODS[mt].label} started ($${cost}M, ${state.research[id]} months, ${Math.round(researchOdds(state, id, mt) * 100)} % chance to find a solvent).`
      : `Pilot test of the ${pr.short} funded ($${cost}M, ${state.research[id]} months).`);
    return chk;
  }
  function setPrice(state, price) { state.price = Math.max(40, Math.min(220, Math.round(price))); }

  // ---- events -----------------------------------------------------------------
  const CFG = { P_CHOICE: 0.010, P_FORCED: 0.014, GAP: 12 };   // \u2248 5\u20136 events a game, never two within a year
  const SHIP = { months: 4, perTonne: 12 };   // backup CO2 shipping while the storage site is reviewed
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
    const rg = RG(state);
    const mo = state.m % 12;
    const peakMonths = rg.peak === 'cold' ? [11, 0, 1] : [5, 6, 7, 8];
    if (up.length) {
      if (peakMonths.includes(mo)) for (let k = 0; k < rg.heat; k++) pool.push('heat');
      if (rg.typhoon && mo >= 6 && mo <= 9) pool.push('typhoon');
    }
    if (cap.length && state.captureOff <= 0 && (state.seen.storage || 0) < 2) pool.push('storage');
    if (amine.length && !state.seen.wash) pool.push('wash');
    if (!pool.length) return;
    const id = pool[Math.floor(R() * pool.length)];
    state.seen[id] = (state.seen[id] || 0) + 1;
    if (id === 'heat') {
      state.demandMult = 1.12; state.demandMonths = 3;
      const cold = rg.peak === 'cold';
      if (!cap.length || state.captureOff > 0) {
        headline(state, cold ? 'cold' : 'heat', 'bad', cold ? 'Cold snap grips the city' : 'Heat wave grips the city', 'Power demand +12 % for three months',
          cold ? 'Electric heaters run day and night. Keep enough plants online or the lights go out.' : 'Air-conditioners run day and night. Keep enough plants online or the lights go out.');
        return;
      }
      const mw = cap.reduce((a, p) => a + p.gross * penalty(p, p.tech), 0);
      state.pending = {
        id, title: cold ? 'Cold snap!' : 'Heat wave!', text: `${cold ? 'Electric heaters' : 'Air-conditioners'} push demand up 12 % for 3 months. Capture eats steam that could make power.`,
        opts: [
          { label: 'Pause capture for 2 months', effect: `+${Math.round(mw)} MW \u00b7 ${offText(state, 2)}` },
          { label: 'Keep capturing', effect: 'Risk blackouts' },
        ],
      };
    } else if (id === 'storage') {
      state.pending = {
        id, title: 'Protest at the CO\u2082 storage site', text: 'Residents near the injection wells demand that the storage site close for a safety review.',
        opts: [
          { label: 'Ignore them', effect: 'Public anger +12' },
          { label: 'Accept the review', effect: `Ship CO\u2082 to a backup site for ${SHIP.months} months, \u2248 $${Math.round((state.last ? state.last.captured : 0) * SHIP.perTonne * SHIP.months / 1e6)}M \u00b7 no extra emissions` },
        ],
      };
    } else if (id === 'wash') {
      state.pending = {
        id, title: 'Amine emissions study', text: 'A university study finds traces of amine degradation products downwind of the capture plants.',
        opts: [
          { label: 'Install water-wash sections', effect: `$${20 * amine.length}M for ${amine.length} plant${amine.length > 1 ? 's' : ''}` },
          { label: 'Dismiss the study', effect: 'Public anger +8' },
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
      if (i === 0) { state.captureOff = 2; state.captureOffWhy = 'heat-wave pause'; addNews(state, 'event', 'Heat wave: capture paused for 2 months to keep the lights on.'); }
      else addNews(state, 'event', 'Heat wave: capture stays on. Hope the grid holds.');
    } else if (ev.id === 'storage') {
      if (i === 0) { state.anger = Math.min(100, state.anger + 12); addNews(state, 'event', 'You ignored the storage-site protest. Public anger +12.'); }
      else { state.shipMonths = SHIP.months; addNews(state, 'event', `Storage site under review: captured CO\u2082 is shipped to a backup site for ${SHIP.months} months ($${SHIP.perTonne}/t).`); }
    } else if (ev.id === 'wash') {
      if (i === 0) {
        const am = capturing(state).filter(p => !p.washed);
        state.funds -= 20 * am.length; am.forEach(p => { p.washed = true; });
        addNews(state, 'build', `Water-wash sections installed on ${am.length} plant${am.length > 1 ? 's' : ''} ($${20 * am.length}M).`);
      } else { state.anger = Math.min(100, state.anger + 8); addNews(state, 'event', 'You dismissed the amine study. Public anger +8.'); }
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
    const rg = RG(state);
    const mo = state.m % 12;
    if (hasGas) { pool.push('gas'); if (rg.lng) pool.push('lng', 'lng'); if (rg.winter && (mo === 11 || mo <= 1)) pool.push('winter', 'winter', 'winter'); }
    if (state.rate > 6) pool.push('health');
    if (!state.usCut && state.m >= 18) pool.push('uscut');
    const k = pool[Math.floor(R() * pool.length)];
    if (k === 'gas') {
      state.gasMult = 1.8; state.gasMonths = 6;
      headline(state, 'gas', 'bad', 'Gas prices soar', 'Gas fuel costs 80 % more for six months',
        'A cold spell abroad and a pipeline outage send gas prices to a record. Every gas plant in Capture City pays 80 % more for its fuel until the market calms down.');
    } else if (k === 'lng') {
      state.lngCut = 2;
      headline(state, 'lng', 'bad', 'LNG tanker stuck at sea', 'Gas plants at half power for two months',
        'The island keeps only days of liquefied gas in its tanks. With the next tanker delayed by a storm, gas plants must run at half power until supply is back.');
    } else if (k === 'winter') {
      state.gasFreeze = 1;
      headline(state, 'winter', 'bad', 'Winter storm freezes gas wells', 'Gas plants at 30 % for a month',
        'Frozen wellheads and pipes choke the gas supply. Gas plants can only run at 30 % this month, just as heaters push demand up.');
    } else if (k === 'subsidy') {
      state.subsidy = 12;
      headline(state, 'subsidy', 'good', 'Government backs carbon capture', 'Capture projects 30 % cheaper for a year',
        'A new clean-air package pays part of every capture project started in the next 12 months: installing, switching and upgrading capture all cost 30 % less.');
    } else if (k === 'health') {
      state.anger = Math.min(100, state.anger + 8);
      headline(state, 'health', 'bad', 'Doctors link smog to asthma', 'Public anger +8',
        'A hospital study finds more childhood asthma in neighbourhoods downwind of the power plants. Parents are marching outside City Hall.');
    } else {
      state.usCut = true; state.resCut = 24; state.opexCut = 24;
      headline(state, 'subcut', 'bad', 'President axes carbon-capture funding', 'Research +50 %, capture running costs +30 % for two years',
        'The White House has cancelled federal support for carbon capture overnight. Partner labs lose their grants, so every lab project costs 50 % more, and solvent and service suppliers pass on their losses: running a capture plant costs 30 % more. Both last two years.');
    }
  }
  // a front-page story: the page shows it as a newspaper and the game waits until it is read
  function headline(state, id, tone, title, deck, text) {
    state.headlineN = (state.headlineN || 0) + 1;
    state.headline = { n: state.headlineN, id, tone, title, deck, text };
    addNews(state, tone === 'good' ? 'good' : id === 'subcut' ? 'policy' : 'event', `${title}: ${deck}.`);
  }

  // ---- one month --------------------------------------------------------------
  function step(state) {
    if (state.over || state.pending) return state;
    const R = rng(state.seed + state.m * 7919);
    const y = year(state);

    // scheduled news
    const rgn = RG(state);
    if (rgn.tax && state.m === Math.max(0, (rgn.tax.from - START_YEAR) * 12 - 36)) {
      addNews(state, 'policy', `A carbon price is coming: $${rgn.tax.base} per tonne from ${rgn.tax.from}, rising $${rgn.tax.step} every year.`);
    }
    if (state.m % 12 === 0 && state.m > 0) {
      addNews(state, 'policy', `${y}: carbon price $${carbonTax(y, state)}/t, CO\u2082 limit ${f1(limitFor(state, y))} Mt/yr and falling.`);
      // forecast: warn once when today's emissions will pass the limit within 3 years
      for (let k = 1; k <= 3; k++) {
        if (state.rate > limitFor(state, y + k) && state.warnedYear !== y + k && state.rate <= limitFor(state, y)) {
          state.warnedYear = y + k;
          addNews(state, 'event', `Forecast: at today's emissions you pass the CO\u2082 limit in ${y + k}. Cut emissions before then.`);
          flash(state, 'event', `Forecast: you pass the CO\u2082 limit in ${y + k} at today's emissions.`);
          break;
        }
      }
    }

    // gas market drifts every month (imported LNG)

    // research progress
    for (const id of Object.keys(state.research)) {
      state.research[id] -= 1;
      if (state.research[id] <= 0) {
        const mt = state.resMethod[id] || 'exp';
        const odds = researchOdds(state, id, mt);
        delete state.research[id];
        const pr = project(id);
        if (id !== 'screen') {
          state.unlocked[id] = true;
          addNews(state, 'lab', `Breakthrough! ${pr.name} is ready to install.`);
          flash(state, 'lab', `Research done: ${pr.name}.`);
        } else if (R() < odds && undiscovered(state).length) {
          const found = drawSolvent(state, R);
          state.unlocked[found] = true;
          state.tries.screen = 0;
          state.discovery = { n: (state.discovery ? state.discovery.n : 0) + 1, id: found, method: mt };
          addNews(state, 'lab', `Discovery! ${mt === 'comp' ? 'Computer screening' : 'Lab experiments'} found ${TECHS[found].name} (${'\u2605'.repeat(DROPS[found].stars)}).`);
        } else {
          state.tries.screen = (state.tries.screen || 0) + 1;
          const why = mt === 'comp'
            ? `the predicted candidates failed in the lab. The next screen learns from it (+${Math.round(METHODS.comp.learn * 100)} % odds)`
            : 'the experiments hit a dead end';
          addNews(state, 'event', `Screening came up empty: ${why}.`);
          flash(state, 'event', 'Screening came up empty. Try again.');
        }
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
    // the next queued job starts as soon as a plant (or the lab) is free
    startQueues(state);
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
    const tax = carbonTax(y, state);
    const credit = rgn.credit;   // paid per tonne captured (Texas)
    const units = state.plants.filter(online).map(p => {
      const pt = PLANT_TYPES[p.type];
      const on = p.tech && p.outage <= 0 && state.captureOff <= 0;
      const e = on ? eff(p.tech, p.deep, p.type) : null;
      if (e && state.opexCut > 0) e.opex *= 1.3;   // subsidy cut: suppliers pass on their losses
      const c = e ? e.capture : 0;
      const pen = e ? pt.intensity * c * workPerTonne(e) : 0;
      const fuel = p.type === 'gas' ? gasFuel(state) : pt.fuel;
      const avail = p.type === 'gas' ? (state.gasFreeze > 0 ? 0.3 : state.lngCut > 0 ? 0.5 : 1) : 1;
      const perGross = fuel + (e ? (e.opex - credit) * pt.intensity * c : 0) + tax * pt.intensity * (1 - c);
      return { p, pt, e, c, pen, netCap: p.gross * avail * (1 - pen), marginal: perGross / (1 - pen), fuel };
    }).sort((a, b) => a.marginal - b.marginal);

    const D = demand(state);
    let left = D, revenue = 0, cost = 0, emitted = 0, captured = 0, served = 0, netCapTotal = 0;
    let surplus = D * SURPLUS_SHARE, soldMW = 0, taxPaid = 0;
    const burn = (u, mw, price) => {           // run a unit for `mw` net and book it at `price` per MWh
      const netMWh = mw * HOURS;
      const grossMWh = netMWh / (1 - u.pen);
      const co2 = grossMWh * u.pt.intensity;         // t
      const cap = co2 * u.c, emi = co2 - cap;
      emitted += emi; captured += cap;
      cost += grossMWh * u.fuel + (u.e ? cap * u.e.opex : 0) + emi * tax;
      taxPaid += emi * tax;
      revenue += netMWh * price;
      return netMWh;
    };
    for (const u of units) {
      netCapTotal += u.netCap;
      const run = Math.min(u.netCap, left);
      left -= run;
      served += burn(u, run, state.price);
      u.run = run;
    }
    // spare capacity is sold to industrial / wholesale buyers when it pays (a dirty plant stops paying once carbon is priced)
    for (const u of units) {
      const spare = Math.min(u.netCap - u.run, surplus);
      if (spare <= 0 || u.marginal >= rgn.wholesale) continue;
      burn(u, spare, rgn.wholesale);
      surplus -= spare; soldMW += spare; u.run += spare;
    }
    // neighbours lend power in a shortage (Europe)
    let importMW = 0;
    if (rgn.imports && left > 0) { importMW = Math.min(left, rgn.imports); left -= importMW; served += importMW * HOURS; revenue += importMW * HOURS * state.price; cost += importMW * HOURS * 150; }
    for (const p of state.plants) cost += p.gross * PLANT_TYPES[p.type].fixed * 1e6;   // fixed O&M, running or not
    const creditPaid = captured * credit;
    cost -= creditPaid;
    if (state.shipMonths > 0) cost += captured * SHIP.perTonne;
    state.sold = soldMW; state.soldTotal += soldMW * HOURS / 1000; state.imported = importMW; state.creditPaid += creditPaid / 1e6; state.taxPaid += taxPaid / 1e6;
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

    const baseRate = rgn.base * HOURS * 0.95;           // t/month if all-coal, no capture (smog scale)
    const smog = emitted / baseRate;
    const FAIR = rgn.fair;
    let dA = 7 * Math.max(0, (state.price - FAIR) / FAIR)
           + 40 * unservedFrac
           + 1.2 * smog
           + 0.02 * state.greenhouse
           - 1.0;
    if (state.price < FAIR) dA -= 0.8 * (FAIR - state.price) / FAIR;
    state.anger = Math.max(0, Math.min(100, state.anger + dA));
    if (unservedFrac > 0.02) { state.blackouts += 1; addNews(state, 'event', `Blackouts: ${Math.round(unservedFrac * 100)} % of demand unserved!`); }

    // timers
    if (state.demandMonths > 0 && --state.demandMonths === 0) state.demandMult = 1;
    if (state.gasMonths > 0 && --state.gasMonths === 0) state.gasMult = 1;
    if (state.subsidy > 0) state.subsidy -= 1;
    if (state.resCut > 0) state.resCut -= 1;
    if (state.opexCut > 0 && --state.opexCut === 0) addNews(state, 'good', 'Capture running costs are back to normal.');
    if (state.lngCut > 0 && --state.lngCut === 0) addNews(state, 'good', 'LNG supply is back to normal.');
    if (state.gasFreeze > 0) state.gasFreeze -= 1;
    if (state.shipMonths > 0 && --state.shipMonths === 0) addNews(state, 'good', 'The storage site is open again.');
    if (state.captureOff > 0 && --state.captureOff === 0) addNews(state, 'good', 'Capture is back on.');
    for (const p of state.plants) if (p.down > 0 && --p.down === 0) addNews(state, 'good', `${p.name} is running again.`);

    state.last = {
      demand: D, netCap: netCapTotal, served: served / HOURS, unservedFrac, emitted, captured, limit: lim,
      revenue: revenue / 1e6, cost: cost / 1e6 + overhead / 1e6, profit, tax, credit, gasFuel: gasFuel(state), sold: soldMW, imported: importMW,
      units: units.map(u => ({ id: u.p.id, run: u.run, netCap: u.netCap, pen: u.pen, c: u.c })),
    };

    state.m += 1;
    if (state.greenhouse >= 100) state.over = { win: false, why: 'greenhouse' };
    else if (state.anger >= 100) state.over = { win: false, why: 'anger' };
    else if (state.funds < BANKRUPT) state.over = { win: false, why: 'bankrupt' };
    else if (state.m >= MONTHS) state.over = { win: true, why: 'survived' };

    // random events for next month (a choice pauses the game until answered)
    if (!state.over && state.m > 6 && state.m - (state.lastEventM || -99) >= CFG.GAP) {
      const r = R();
      const hl = state.headlineN;
      if (r < CFG.P_CHOICE) offerChoice(state, R);
      else if (r < CFG.P_CHOICE + CFG.P_FORCED) forcedEvent(state, R);
      if (state.pending || state.headlineN !== hl) state.lastEventM = state.m;
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
    const [two, three] = RG(s).stars;
    return sc >= three ? 3 : sc >= two ? 2 : 1;
  }

  const api = {
    HOURS, MONTHS, START_YEAR, END_YEAR, FAIR_PRICE, BANKRUPT, MAX_PLANTS, DEMOLISH_COST, LIMIT_POINTS, LIMIT_SCALE,
    BREACH, breachStep, REGIONS, SEASON, SURPLUS_SHARE, SHIP, METHODS, DROPS, PROVEN_MONTHS, DEEP, PLANT_TYPES, CONVERT, TECHS, TECH_ORDER, PROJECTS, LAB_ORDER, CFG, STARS,
    newGame, step, choose, offCost, online,
    install, canInstall, installCost, installMonths, upgrade, canUpgrade, upgradeCost,
    QUEUE_MAX, planned, canQueue, enqueue, cancelJob, canQueueResearch, enqueueResearch, cancelResearch,
    convert, canConvert, buildPlant, canBuildPlant, demolish, canDemolish,
    startResearch, canResearch, researchCost, researchMonths, researchOdds, project, maturity,
    setPrice, penalty, eff, workPerTonne, carbonTax, taxFor, limit, limitAt, limitFor, fairPrice, gasFuel, demand, peakDemand, seasonOf, year, monthName, score, stars,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
