/* Capture City 2050 \u2014 game model v2 (pure logic, no DOM).
 * Used by index.html in the browser and by sim_test.js under node for balancing.
 *
 * Technology numbers come from Lin Research Group (NTHU) papers where the paper reports them;
 * everything marked `est: true` is a game estimate (the paper does not give that number).
 *   MEA regeneration 3.5 GJ/t ......... Chen, Wu & Lin, Chem. Eng. J. 2026 (155 kJ/mol CO2)
 *   Advanced MEA stripper 2.8 GJ/t .... Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025 (122 kJ/mol)
 *   MEA\u2013NMP \u221230\u201350 % duty (cited) ..... Chen, Chen & Lin, Fluid Phase Equilib. 2026 (we use \u221225 %, conservative)
 *   AMP\u2013NMP 3\u00d7 faster, ~2\u00d7 capacity ... Cheng, Chen & Lin, Chem. Eng. J. 2025 (duty not reported -> est. 3.0,
 *                                       kept above the measured 2PE\u2013EG value; high capacity -> low running cost, est.)
 *                                       AMP carbamate precipitates at high loading (same paper; Chen, Wu & Lin 2026)
 *   2PE\u2013EG 2.9 GJ/t (128 kJ/mol) ...... Chen, Wu & Lin, Chem. Eng. J. 2026 (70 EG/30 H2O; 4.5\u00d7 rate, 2.8\u00d7 capacity;
 *                                       25.8 cP vs 1.7 cP for MEA -> start-up trouble in the heat exchanger)
 *   VPSA 265\u2013333 kWh/t, 81 % recovery . Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025
 *   99 % capture needs 20\u201330 m packing  Chang, Chou & Lin, Sep. Purif. Technol. 2025 (+9 % duty is est.)
 *   QM + MD screening, 28 amines ...... Chien, Wu & Lin, GHGT-18 (2026): reaction \u0394G MAE 3.6 kJ/mol
 *
 * Game rules that are NOT from papers: plant sizes, prices, the CO2 limit path, event odds,
 * start-up failure odds (stage-based), research costs and times.
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

  // Legal CO2 limit (Mt per year). It tightens every year toward net zero in 2050.
  const LIMIT_POINTS = [[2026, 10.5], [2028, 9.8], [2030, 8.5], [2035, 5.5], [2040, 2.5], [2045, 1.0], [2050, 0.4]];
  const LIMIT_SCALE = 12;             // meter full scale (Mt/yr)
  const DEBT_MAX = 2.5;                 // Mt emitted above the limit before the licence is revoked
  const REPAY = 0.25;                 // share of monthly headroom that pays the debt back
  const PROVEN_MONTHS = 24;           // months of operation before a new solvent stops failing
  const SCREEN_TIME = 0.7, SCREEN_RISK = 0.5;   // QM+MD screening: research time and start-up risk factors

  const PLANT_TYPES = {
    coal: { label: 'Coal', intensity: 0.95, fuel: 30, fixed: 0.0030, capexFactor: 1.0 },
    gas:  { label: 'Gas',  intensity: 0.37, fuel: 55, fixed: 0.0020, capexFactor: 0.75 },
  };

  // capture: fraction captured; duty: regeneration GJ/t (0 for VPSA); elec: MWh/t direct electricity
  // capex: $M per MW gross (coal basis); opex: $/t captured
  // stage: how far the technology has been scaled up; startup: monthly failure odds until proven
  const TECHS = {
    mea90: {
      name: 'MEA \u00b7 90 %', short: 'MEA 90%', family: 'amine', capture: 0.90, duty: 3.5, capex: 1.00, opex: 10,
      unlocked: true, color: '#5B8DEF', stage: 'Commercial', startup: 0,
      fact: '30 wt% MEA, the industry benchmark. Regeneration \u2248 3.5 GJ per tonne CO\u2082.',
      src: 'Chen, Wu & Lin, Chem. Eng. J. 2026',
    },
    mea99: {
      name: 'MEA \u00b7 99 %', short: 'MEA 99%', family: 'amine', capture: 0.99, duty: 3.8, capex: 1.35, opex: 11,
      unlocked: true, color: '#3F6FD8', est: ['duty'], stage: 'Commercial', startup: 0,
      fact: 'Pushing MEA past 99 % capture needs 20\u201330 m of packing: taller, costlier columns.',
      src: 'Chang, Chou & Lin, Sep. Purif. Technol. 2025',
    },
    vpsa: {
      name: 'Adsorption (VPSA)', short: 'VPSA', family: 'sorbent', capture: 0.81, duty: 0, elec: 0.30, capex: 1.60, opex: 6,
      unlocked: true, color: '#B07CE8', stage: 'Demonstrated', startup: 0.008,
      fail: 'vacuum pump trouble',
      fact: 'Vacuum pressure swing adsorption runs on electricity (265\u2013333 kWh/t), no steam and no amine. 81 % recovery at 99.9 % purity with cryogenic polishing.',
      src: 'Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025',
    },
    afs: {
      name: 'MEA + advanced stripper', short: 'MEA-AS', family: 'amine', capture: 0.90, duty: 2.8, capex: 1.15, opex: 10,
      unlocked: false, research: { cost: 80, months: 12 }, color: '#2BB3C0', stage: 'Pilot-tested', startup: 0.012,
      deepable: true, fail: 'the new stripper would not hold steady',
      fact: 'A heat-integrated stripper cuts MEA regeneration to \u2248 2.8 GJ/t.',
      src: 'Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025',
    },
    meanmp: {
      name: 'MEA\u2013NMP (semi-aqueous)', short: 'MEA-NMP', family: 'amine', capture: 0.90, duty: 2.6, capex: 1.10, opex: 12,
      unlocked: false, research: { cost: 120, months: 18 }, color: '#1FA88A', est: ['duty'], stage: 'Pilot-tested', startup: 0.02,
      deepable: true, solvent: true, fail: 'the water balance drifted and the solvent had to be topped up',
      fact: 'Replacing part of the water with NMP (40 % lower heat capacity) cut regeneration duty by 30\u201350 % in pilot tests; the game uses \u221225 %.',
      src: 'Chen, Chen & Lin, Fluid Phase Equilib. 2026',
    },
    ampnmp: {
      name: 'AMP\u2013NMP (semi-aqueous)', short: 'AMP-NMP', family: 'amine', capture: 0.90, duty: 3.0, capex: 1.10, opex: 8,
      unlocked: false, research: { cost: 140, months: 18 }, color: '#0E9F6E', est: ['duty'], stage: 'Lab scale', startup: 0.03, risk: 0.004,
      deepable: true, solvent: true, fail: 'AMP carbamate precipitated and clogged a line',
      fact: 'NMP does not react with CO\u2082; it makes the hindered amine AMP 3\u00d7 faster than in water, and AMP holds about twice the CO\u2082 of MEA. Catch: with less water, AMP carbamate can precipitate at high loading, even after start-up.',
      src: 'Cheng, Chen & Lin, Chem. Eng. J. 2025',
    },
    pe2eg: {
      name: '2PE\u2013EG (NTHU)', short: '2PE-EG', family: 'amine', capture: 0.90, duty: 2.9, capex: 1.00, opex: 9,
      unlocked: false, research: { cost: 180, months: 24 }, color: '#E2A93B', est: ['capex'], star: true, stage: 'Lab scale', startup: 0.035,
      deepable: true, solvent: true, fail: 'the viscous solvent overloaded the heat exchanger',
      fact: 'Ethylene glycol reacts: it turns the carbamate into alkyl carbonate and frees the amine again, so 2-piperidineethanol gets both 4.5\u00d7 faster reaction and 2.8\u00d7 cyclic capacity vs MEA; regeneration 128 kJ/mol (\u2248 2.9 GJ/t). Catch: 15\u00d7 more viscous than MEA.',
      src: 'Chen, Wu & Lin, Chem. Eng. J. 2026',
    },
  };
  const TECH_ORDER = ['mea90', 'mea99', 'vpsa', 'afs', 'meanmp', 'ampnmp', 'pe2eg'];

  // research projects that are not a capture technology
  const PROJECTS = {
    screen: {
      name: 'QM + MD solvent screening', short: 'QM+MD', cost: 60, months: 12, star: true,
      desc: 'solvent research \u221230 % time \u00b7 half the start-up failures',
      fact: 'Quantum chemistry and molecular dynamics predict the reaction \u0394G and \u0394H of 28 amines (MAE 3.6 kJ/mol) before a single experiment. This is our GHGT-18 poster.',
      src: 'Chien, Wu & Lin, GHGT-18 (2026)',
    },
    deep: {
      name: '99 % capture design', short: '99 % design', cost: 100, months: 12,
      desc: 'upgrade lab-technology plants to 99 % capture',
      fact: 'Taller packing (20\u201330 m) pushes amine capture past 99 %, at about 9 % more regeneration energy.',
      src: 'Chang, Chou & Lin, Sep. Purif. Technol. 2025', est: ['duty'],
    },
  };
  const LAB_ORDER = ['screen', 'afs', 'meanmp', 'ampnmp', 'pe2eg', 'deep'];

  // ---- technology helpers -----------------------------------------------------
  function eff(techId, deep) {
    const t = TECHS[techId];
    if (!t) return null;
    if (deep) return { capture: 0.99, duty: (t.duty || 0) * 1.09, elec: t.elec || 0, opex: t.opex + 1 };
    return { capture: t.capture, duty: t.duty || 0, elec: t.elec || 0, opex: t.opex };
  }
  // energy (MWh_e) lost per tonne CO2 captured
  function workPerTonne(e) {
    return (e.duty || 0) * GJ_TO_MWH_E + (e.elec || 0) + COMPRESS;
  }
  function penalty(plant, techId, deep) {
    if (deep === undefined) deep = !!plant.deep && plant.tech === techId;
    const e = eff(techId, deep);
    if (!e) return 0;
    return PLANT_TYPES[plant.type].intensity * e.capture * workPerTonne(e);
  }
  function capexFull(plant, techId) {
    return TECHS[techId].capex * plant.gross * PLANT_TYPES[plant.type].capexFactor;
  }
  function installCost(state, plant, techId) {
    const t = TECHS[techId];
    const full = capexFull(plant, techId);
    let c = full;
    const cur = plant.tech ? TECHS[plant.tech] : null;
    if (cur) {
      if (cur.family === 'amine' && t.family === 'amine') {
        // existing columns reused: solvent / stripper retrofit
        c = techId === 'mea99' ? 0.40 * full : 0.35 * full;
      } else {
        c = 0.9 * full;           // switching between amine and sorbent: mostly new build
      }
    }
    if (state.subsidy > 0) c *= 0.7;
    return Math.round(c);
  }
  function installMonths(plant, techId) {
    const cur = plant.tech ? TECHS[plant.tech] : null;
    if (cur && cur.family === 'amine' && TECHS[techId].family === 'amine') return 3;
    return 9;
  }
  function upgradeCost(state, plant) {
    let c = 0.35 * capexFull(plant, plant.tech);
    if (state.subsidy > 0) c *= 0.7;
    return Math.round(c);
  }
  function carbonTax(year) {
    return year < 2030 ? 0 : 50 + 5 * (year - 2030);
  }
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
      desc: (t.duty ? t.duty.toFixed(1) + ' GJ/t regeneration' : '') + ' \u00b7 ' + t.stage.toLowerCase(), solvent: t.solvent };
  }
  function researchCost(state, id) {
    return Math.round(project(id).cost * (state.resCut > 0 ? 1.5 : 1));
  }
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

  function newGame(seed) {
    const unlocked = {};
    TECH_ORDER.forEach(id => { unlocked[id] = !!TECHS[id].unlocked; });
    Object.keys(PROJECTS).forEach(id => { unlocked[id] = false; });
    return {
      seed: seed || Math.floor(Math.random() * 1e9),
      m: 0, funds: 700, price: 100, cumCO2: 0, captured: 0, anger: 10,
      greenhouse: 0, debt: 0, maxDebt: 0, rate: 0, recent: [], overMonths: 0, wasOver: false,
      over: null, subsidy: 0, resCut: 0, usCut: false, captureOff: 0, captureOffWhy: '',
      plants: [
        { id: 'A', name: 'Coal Plant A', type: 'coal', gross: 600, tech: null, deep: false, build: null, outage: 0, down: 0 },
        { id: 'B', name: 'Coal Plant B', type: 'coal', gross: 600, tech: null, deep: false, build: null, outage: 0, down: 0 },
        { id: 'C', name: 'Gas Plant C',  type: 'gas',  gross: 400, tech: null, deep: false, build: null, outage: 0, down: 0 },
      ],
      lot: { built: false, build: null, cost: 420, months: 12 },
      unlocked, research: {}, exp: {},  // research[id] = months left; exp[tech] = months in operation
      demandMult: 1, demandMonths: 0, gasMult: 1, gasMonths: 0,
      pending: null, flash: null, flashN: 0, seen: {}, fails: 0, blackouts: 0,
      news: [{ m: 0, kind: 'info', text: 'You run the power utility of Capture City. Keep the lights on until 2050 and stay under the CO\u2082 limit.' }],
      last: null, techUsed: {},
    };
  }

  function year(state) { return START_YEAR + Math.floor(state.m / 12); }
  function monthName(state) {
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][state.m % 12];
  }
  function demand(state) {
    return 1150 * Math.pow(1.01, state.m / 12) * state.demandMult;
  }
  function addNews(state, kind, text) {
    state.news.unshift({ m: state.m, kind, text });
    if (state.news.length > 30) state.news.pop();
  }
  function flash(state, kind, text) {
    state.flashN += 1;
    state.flash = { n: state.flashN, kind, text };
  }
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);

  // ---- player actions -------------------------------------------------------
  function canInstall(state, plant, techId) {
    if (!state.unlocked[techId]) return { ok: false, why: 'Locked: fund the research first' };
    if (plant.build) return { ok: false, why: 'Construction in progress' };
    if (plant.tech === techId) return { ok: false, why: 'Already installed' };
    const cost = installCost(state, plant, techId);
    if (state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost };
  }
  function install(state, plantId, techId) {
    const p = state.plants.find(x => x.id === plantId);
    const chk = canInstall(state, p, techId);
    if (!chk.ok) return chk;
    state.funds -= chk.cost;
    const n = installMonths(p, techId);
    p.build = { tech: techId, deep: false, left: n, total: n };
    addNews(state, 'build', `${p.name}: ${TECHS[techId].short} construction started ($${chk.cost}M).`);
    return chk;
  }
  function canUpgrade(state, plant) {
    const t = plant.tech ? TECHS[plant.tech] : null;
    if (!t || !t.deepable) return { ok: false, why: 'Only for lab technologies' };
    if (plant.deep) return { ok: false, why: 'Already at 99 %' };
    if (!state.unlocked.deep) return { ok: false, why: 'Locked: fund \u201c99 % capture design\u201d first' };
    if (plant.build) return { ok: false, why: 'Construction in progress' };
    const cost = upgradeCost(state, plant);
    if (state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost };
  }
  function upgrade(state, plantId) {
    const p = state.plants.find(x => x.id === plantId);
    const chk = canUpgrade(state, p);
    if (!chk.ok) return chk;
    state.funds -= chk.cost;
    p.build = { tech: p.tech, deep: true, left: 3, total: 3 };
    addNews(state, 'build', `${p.name}: 99 % capture upgrade started ($${chk.cost}M).`);
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
  function buildGasPlant(state) {
    if (state.lot.built || state.lot.build) return { ok: false, why: 'Already built' };
    if (state.funds < state.lot.cost) return { ok: false, why: 'Not enough funds' };
    state.funds -= state.lot.cost;
    state.lot.build = { left: state.lot.months, total: state.lot.months };
    addNews(state, 'build', `New gas plant D under construction ($${state.lot.cost}M, 12 months).`);
    return { ok: true };
  }
  function setPrice(state, price) { state.price = Math.max(40, Math.min(220, Math.round(price))); }

  // ---- events -----------------------------------------------------------------
  const CFG = { P_CHOICE: 0.022, P_FORCED: 0.02 };
  function offCost(state, months) {
    const L = state.last;
    if (!L) return { extra: 0, debt: 0 };
    const extra = L.captured / 1e6 * months;                          // Mt no longer captured
    const monthly = (L.emitted + L.captured) / 1e6;                   // Mt/month with capture off
    const debt = Math.max(0, monthly - limit(state) / 12) * months;
    return { extra, debt };
  }
  function offText(state, months) {
    const o = offCost(state, months);
    return `\u2248 +${f1(o.extra)} Mt CO\u2082, ` + (o.debt > 0.05 ? `CO\u2082 debt +${f1(o.debt)} Mt` : 'still under the limit');
  }
  function capturing(state) {
    return state.plants.filter(p => p.tech && !p.build && p.down <= 0 && p.outage <= 0);
  }
  function offerChoice(state, R) {
    const L = state.last;
    const cap = capturing(state);
    const amine = cap.filter(p => TECHS[p.tech].family === 'amine' && !p.washed);
    const pool = ['heat', 'typhoon'];
    if (cap.length && state.captureOff <= 0 && (state.seen.storage || 0) < 2) pool.push('storage');
    if (amine.length && !state.seen.wash) pool.push('wash');
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
          { label: 'Bypass capture for 3 months', effect: `+${Math.round(mw)} MW \u00b7 ${offText(state, 3)}` },
          { label: 'Keep capturing', effect: 'Risk blackouts' },
        ],
      };
    } else if (id === 'storage') {
      state.pending = {
        id, title: 'Protest at the CO\u2082 storage site', text: 'Residents near the injection wells demand that the storage site close for a safety review.',
        opts: [
          { label: 'Ignore them', effect: 'Public anger +20' },
          { label: 'Accept the review', effect: `All capture offline 6 months (no carbon tax meanwhile) \u00b7 ${offText(state, 6)}` },
        ],
      };
    } else if (id === 'wash') {
      state.pending = {
        id, title: 'Amine emissions study', text: 'A university study finds traces of amine degradation products downwind of the capture plants.',
        opts: [
          { label: 'Install water-wash sections', effect: `$${20 * amine.length}M for ${amine.length} amine plant${amine.length > 1 ? 's' : ''}` },
          { label: 'Dismiss the study', effect: 'Public anger +12' },
        ],
      };
    } else {
      const up = state.plants.filter(p => p.down <= 0);
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
      if (i === 0) { state.captureOff = 3; state.captureOffWhy = 'heat-wave bypass'; addNews(state, 'event', 'Heat wave: capture bypassed for 3 months to keep the lights on.'); }
      else addNews(state, 'event', 'Heat wave: capture stays on. Hope the grid holds.');
    } else if (ev.id === 'storage') {
      if (i === 0) { state.anger = Math.min(100, state.anger + 20); addNews(state, 'event', 'You ignored the storage-site protest. Public anger +20.'); }
      else { state.captureOff = 6; state.captureOffWhy = 'storage-site review'; addNews(state, 'event', 'Storage site closed for review: all capture offline for 6 months.'); }
    } else if (ev.id === 'wash') {
      if (i === 0) {
        const am = capturing(state).filter(p => TECHS[p.tech].family === 'amine' && !p.washed);
        state.funds -= 20 * am.length; am.forEach(p => { p.washed = true; });
        addNews(state, 'build', `Water-wash sections installed on ${am.length} amine plant${am.length > 1 ? 's' : ''} ($${20 * am.length}M).`);
      } else { state.anger = Math.min(100, state.anger + 12); addNews(state, 'event', 'You dismissed the amine study. Public anger +12.'); }
    } else if (ev.id === 'typhoon') {
      const p = state.plants.find(x => x.id === ev.plant);
      if (i === 0) { state.funds -= 60; p.down = 1; p.downWhy = 'typhoon repair'; addNews(state, 'event', `${p.name}: emergency typhoon repair ($60M), back next month.`); }
      else { p.down = 4; p.downWhy = 'typhoon repair'; addNews(state, 'event', `${p.name}: standard typhoon repair, offline 4 months.`); }
    }
  }
  function forcedEvent(state, R) {
    const pool = ['gas', 'subsidy'];
    if (state.rate > 6) pool.push('health');
    if (!state.usCut && state.m >= 18) pool.push('uscut');
    const k = pool[Math.floor(R() * pool.length)];
    if (k === 'gas') {
      state.gasMult = 1.8; state.gasMonths = 6;
      addNews(state, 'event', 'Gas price spike: gas fuel costs 80 % more for 6 months.');
      flash(state, 'event', 'Gas price spike: gas fuel +80 % for 6 months.');
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

    // research + construction progress
    for (const id of Object.keys(state.research)) {
      state.research[id] -= 1;
      if (state.research[id] <= 0) {
        delete state.research[id];
        state.unlocked[id] = true;
        const pr = project(id);
        if (id === 'screen') {
          for (const k of Object.keys(state.research)) {
            if (project(k).solvent) state.research[k] = Math.max(1, Math.ceil(state.research[k] * SCREEN_TIME));
          }
          addNews(state, 'lab', 'QM + MD screening is running: solvent research is 30 % faster and start-ups fail half as often.');
        } else if (id === 'deep') {
          addNews(state, 'lab', 'Breakthrough! Lab-technology plants can now be upgraded to 99 % capture.');
        } else {
          addNews(state, 'lab', `Breakthrough! ${pr.name} is ready to install.`);
        }
        flash(state, 'lab', `Research done: ${pr.name}.`);
      }
    }
    for (const p of state.plants) {
      if (p.build) {
        p.build.left -= 1;
        if (p.build.left <= 0) {
          if (p.tech !== p.build.tech) p.washed = false;
          p.tech = p.build.tech; p.deep = !!p.build.deep; p.build = null;
          state.techUsed[p.tech] = true;
          addNews(state, 'build', `${p.name}: ${TECHS[p.tech].short}${p.deep ? ' at 99 %' : ''} capture is online.`);
        }
      }
      if (p.outage > 0) { p.outage -= 1; continue; }
      if (!p.tech || p.down > 0) continue;
      const t = TECHS[p.tech];
      const mat = maturity(state, p.tech);
      if (mat.risk > 0 && R() < mat.risk) {
        p.outage = 3; p.outageWhy = 'start-up failure'; p.down = 1; p.downWhy = 'tripped';
        state.funds -= 15; state.fails += 1;
        addNews(state, 'event', `${p.name}: ${t.short} start-up failure, ${t.fail}. Plant tripped for a month, capture offline 3 months, repair $15M (${mat.exp}/${PROVEN_MONTHS} months of experience).`);
        flash(state, 'event', `${p.name}: ${t.short} start-up failure, ${t.fail}.`);
      } else if (t.risk && R() < t.risk) {
        p.outage = 2; p.outageWhy = 'precipitation';
        addNews(state, 'event', `${p.name}: AMP carbamate precipitated, capture offline for 2 months.`);
        flash(state, 'event', `${p.name}: solvent precipitation, capture offline 2 months.`);
      }
    }
    if (state.lot.build) {
      state.lot.build.left -= 1;
      if (state.lot.build.left <= 0) {
        state.lot.build = null; state.lot.built = true;
        state.plants.push({ id: 'D', name: 'Gas Plant D', type: 'gas', gross: 400, tech: null, deep: false, build: null, outage: 0, down: 0 });
        addNews(state, 'build', 'Gas Plant D is online (+400 MW).');
      }
    }

    // dispatch: cheapest net MWh first
    const tax = (state.captureOff > 0 && state.captureOffWhy === 'storage-site review') ? 0 : carbonTax(y);
    const units = state.plants.filter(p => p.down <= 0).map(p => {
      const pt = PLANT_TYPES[p.type];
      const on = p.tech && p.outage <= 0 && state.captureOff <= 0;
      const e = on ? eff(p.tech, p.deep) : null;
      const c = e ? e.capture : 0;
      const pen = e ? pt.intensity * c * workPerTonne(e) : 0;
      const fuel = pt.fuel * (p.type === 'gas' ? state.gasMult : 1);
      const perGross = fuel + (e ? e.opex * pt.intensity * c : 0) + tax * pt.intensity * (1 - c);
      return { p, pt, e, c, pen, netCap: p.gross * (1 - pen), marginal: perGross / (1 - pen), fuel };
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
      cost += u.p.gross * u.pt.fixed * 1e6;             // fixed O&M ($M per MW-month -> $)
      u.run = run;
    }
    for (const p of state.plants) if (p.down > 0) cost += p.gross * PLANT_TYPES[p.type].fixed * 1e6;
    revenue = served * state.price;
    const overhead = 25e6;                              // grid, staff, maintenance
    const profit = (revenue - cost - overhead) / 1e6;   // $M
    state.funds += profit;

    // technology experience (a solvent is proven after 24 months in operation)
    const seen = {};
    for (const p of state.plants) if (p.tech && p.down <= 0) seen[p.tech] = true;
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
    if (monthMt > allow) {
      state.debt += monthMt - allow; state.overMonths += 1;
      if (!state.wasOver) {
        state.wasOver = true;
        addNews(state, 'event', `Over the CO\u2082 limit (${f1(lim)} Mt/yr)! Every tonne above it adds to your CO\u2082 debt.`);
        flash(state, 'event', `Over the CO\u2082 limit! Debt is building up (max ${DEBT_MAX} Mt).`);
      }
    } else {
      state.debt = Math.max(0, state.debt - REPAY * (allow - monthMt));
      state.wasOver = false;
    }
    state.maxDebt = Math.max(state.maxDebt, state.debt);
    state.greenhouse = Math.min(100, state.debt / DEBT_MAX * 100);   // CO2-debt meter

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
    if (state.captureOff > 0 && --state.captureOff === 0) addNews(state, 'good', 'Capture is back online.');
    for (const p of state.plants) if (p.down > 0 && --p.down === 0) addNews(state, 'good', `${p.name} is repaired.`);

    state.last = {
      demand: D, netCap: netCapTotal, served: served / HOURS, unservedFrac, emitted, captured, limit: lim,
      revenue: revenue / 1e6, cost: cost / 1e6 + overhead / 1e6, profit, tax,
      units: units.map(u => ({ id: u.p.id, run: u.run, netCap: u.netCap, pen: u.pen, c: u.c })),
    };

    state.m += 1;
    if (state.debt >= DEBT_MAX) state.over = { win: false, why: 'greenhouse' };
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
  const STAR3 = 3000, STAR2 = 2600;   // sim2.js: MEA -> MEA99 \u2248 2\u2605, planned lab-solvent routes \u2248 3\u2605
  function score(s) {
    return Math.round(Math.max(0, 250 - s.cumCO2) * 6 + (100 - s.anger) * 5 + Math.max(0, s.funds) * 0.5 + s.captured * 1.5);
  }
  function stars(s) {
    if (!s.over || !s.over.win) return 0;
    const sc = score(s);
    return sc >= STAR3 ? 3 : sc >= STAR2 ? 2 : 1;
  }

  const api = {
    HOURS, MONTHS, START_YEAR, END_YEAR, FAIR_PRICE, BANKRUPT, LIMIT_POINTS, LIMIT_SCALE, DEBT_MAX, PROVEN_MONTHS,
    PLANT_TYPES, TECHS, TECH_ORDER, PROJECTS, LAB_ORDER, CFG,
    newGame, step, choose, offCost, install, canInstall, installCost, installMonths, upgrade, canUpgrade, upgradeCost,
    startResearch, canResearch, researchCost, researchMonths, project, maturity,
    buildGasPlant, setPrice, penalty, eff, workPerTonne, carbonTax, limit, limitAt, demand, year, monthName, score, stars,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
