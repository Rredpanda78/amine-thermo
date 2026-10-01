/* Capture City 2050 \u2014 game model v10 (pure logic, no DOM). Every player-facing string has an English text and a
 * Traditional Chinese `zh` twin; the page picks one.
 * Used by index.html in the browser and by sim_public.js / fuzz_public.js under node for balancing.
 *
 * Technology numbers come from Lin Research Group papers where the paper reports them;
 * everything marked `est` is a game estimate (the paper does not give that number).
 *   MEA regeneration 3.5 GJ/t ......... Chen, Wu & Lin, Chem. Eng. J. 2026 (155 kJ/mol CO2)
 *   Advanced MEA stripper 2.8 GJ/t .... Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025 (122 kJ/mol)
 *   AMP/NMP 3\u00d7 faster, ~2\u00d7 capacity ... Cheng, Chen & Lin, Chem. Eng. J. 2025 (duty not reported -> est. 3.0)
 *   Aqueous AMP (trade-off find) ...... Chen, Closmann & Rochelle, Energy Procedia 2011: rate 0.56\u00d7 MEA, capacity 2\u00d7,
 *                                       73 vs 82 kJ/mol, 1.8\u00d7 packing; Le Li 2015 dissertation: 3.5\u00d7 more volatile;
 *                                       Luo et al. 2016: regeneration about 7 % below MEA (-> 3.25 GJ/t, est.)
 *   2PE/EG 2.9 GJ/t (128 kJ/mol) ...... Chen, Wu & Lin, Chem. Eng. J. 2026 (4.5\u00d7 rate, 2.8\u00d7 capacity, 25.8 cP)
 *   99 %+ capture ..................... Hirata et al., Int. J. Greenh. Gas Control 2020 (with Lin): about +50 % absorber
 *                                       packing reaches 99.5 %, CAPEX per tonne +6 % (+9 % duty is est.)
 *   QM + MD screening, 28 amines ...... Chien, Wu & Lin, GHGT-18 (2026): reaction \u0394G MAE 3.6 kJ/mol
 *   PZ + advanced stripper 2.45 GJ/t .. Suresh Babu & Rochelle, IJGGC 2021; Lin, Chen & Rochelle, Faraday Discuss. 2016
 *   Rotating packed bed ............... Ind. Eng. Chem. Res. 2025 (10.1021/acs.iecr.4c01614): 10\u201320\u00d7 smaller absorber,
 *                                       70 wt% MEA; Carbon Clean CycloneCC 10 t/d pilot (Ruwais 2024). Cost cut is est.
 *   Carbonate fuel cell (MCFC) ........ Campanari et al., IJGGC 2010 (~80 % CO2 cut on a gas plant, efficiency about
 *                                       unchanged, MCFC \u2248 17 % of output); ExxonMobil/FuelCell Energy Rotterdam demo 2026
 * Economics checked against NETL / EIA / IEAGHG (Oct 2026 audit): capture capex \u2248 $1,500/kW (NETL nth-of-a-kind
 * ~$1,700/kW, first units more), CO2 transport + storage per tonne, US 45Q $85/t for 12 years, EU ETS \u2248 $85/t,
 * Taiwan carbon fee NT$300/t (\u2248 $10) from 2026, build times (capture 18 months, coal 4 years, gas ~2 years),
 * coal-to-gas: boiler fuel switch (0.55 t/MWh) vs repowering to combined cycle (0.37 t/MWh).
 *
 * Game rules that are NOT from papers: plant sizes, the CO2 limit path, event odds, start-up failure odds,
 * research costs and times, and the three regions (simplified settings inspired by Taiwan, Germany and Texas).
 */
(function (root) {
  'use strict';

  const HOURS = 730;                 // hours per month
  const GJ_TO_MWH_E = 0.069;          // steam heat -> lost electricity (0.25 equivalent-work factor)
  const COMPRESS = 0.10;              // MWh_e per t CO2 for compression + pumps
  const START_YEAR = 2026, END_YEAR = 2050;
  const MONTHS = (END_YEAR - START_YEAR + 1) * 12;   // Jan 2026 .. Dec 2050
  const FAIR_PRICE = 135;             // $/MWh the public accepts (Taiwan; each region sets its own)
  const START_FUNDS = 1500;           // $M capital budget at the start
  const CAPEX_SCALE = 1.3;            // capture unit \u2248 $1,300 per kW (MEA, coal) before the first-of-a-kind premium
  const FOAK = [1.2, 1.1, 1.0];      // cost of the 1st, 2nd and later unit of the same technology (learning by doing)

  // Regions: accepted price, demand, fuel ($/MWh of output), carbon price path [year, $/t], capture credit,
  // transport + storage ($/t), the limit, grid links, hazards
  const REGIONS = {
    taiwan: {
      label: 'Taiwan', hint: 'standard', stars: [2700, 3200], base: 1150, peak: 'heat', fair: 135, growth: 0.02, gas: 72, coal: 42,
      tax: [[2026, 10], [2029, 10], [2030, 40], [2050, 120]], credit: 0, creditMonths: 0, ts: 15,
      limitMul: 1.0, imports: 0, wholesale: 95, typhoon: true, lng: true, winter: false, heat: 1,
      blurb: 'Island grid, no imports. Gas arrives as LNG by ship and storage is only days deep. Typhoons. Carbon fee $10/t from 2026, jumping to $40 in 2030. CO\u2082 storage offshore still has to be built.',
      zh: { label: '\u53f0\u7063', hint: '\u6a19\u6e96', blurb: '\u5b64\u5cf6\u96fb\u7db2\uff0c\u7121\u6cd5\u9032\u53e3\u96fb\u529b\u3002\u5929\u7136\u6c23\u9760 LNG \u8239\u904b\uff0c\u5b58\u91cf\u53ea\u6709\u5e7e\u5929\u3002\u6709\u98b1\u98a8\u3002\u78b3\u8cbb 2026 \u5e74\u8d77\u6bcf\u5678 10 \u7f8e\u5143\u30012030 \u5e74\u8df3\u5230 40 \u7f8e\u5143\u3002CO\u2082 \u96e2\u5cb8\u5c01\u5b58\u9084\u5728\u8d77\u6b65\u3002' },
    },
    germany: {
      label: 'Germany', hint: 'standard', stars: [3000, 3450], base: 1250, peak: 'cold', fair: 145, growth: 0.012, gas: 70, coal: 25,
      tax: [[2026, 85], [2050, 205]], credit: 0, creditMonths: 0, ts: 35,
      limitMul: 0.9, imports: 300, wholesale: 90, typhoon: false, lng: false, winter: false, heat: 1,
      blurb: 'Lignite and gas heartland under the EU carbon price ($85/t from day one, +$5 a year). Captured CO\u2082 is shipped to North Sea storage. Winter is the peak; European neighbours lend up to 300 MW. Margins are thin: price close to what people accept.',
      zh: { label: '\u5fb7\u570b', hint: '\u6a19\u6e96', blurb: '\u8910\u7164\u8207\u5929\u7136\u6c23\u91cd\u93ae\uff0c\u7b2c\u4e00\u5929\u5c31\u9069\u7528\u6b50\u76df\u78b3\u50f9(\u6bcf\u5678 85 \u7f8e\u5143\uff0c\u6bcf\u5e74 +5)\u3002\u6355\u6349\u7684 CO\u2082 \u7528\u8239\u904b\u5230\u5317\u6d77\u5c01\u5b58\u3002\u51ac\u5b63\u662f\u7528\u96fb\u5c16\u5cf0\uff0c\u6b50\u6d32\u9130\u570b\u6700\u591a\u652f\u63f4 300 MW\u3002\u5229\u6f64\u5f88\u8584\uff1a\u96fb\u50f9\u8981\u63a5\u8fd1\u5927\u5bb6\u80fd\u63a5\u53d7\u7684\u4e0a\u9650\u3002' },
    },
    texas: {
      label: 'Texas', hint: 'fast growth', stars: [3300, 3560], base: 1300, peak: 'heat', fair: 75, growth: 0.025, gas: 26, coal: 23,
      tax: null, credit: 85, creditMonths: 144, ts: 12,
      limitMul: 1.15, imports: 0, wholesale: 55, typhoon: false, lng: false, winter: true, heat: 2,
      blurb: 'No carbon tax: the US 45Q credit pays $85 for every tonne stored, for 12 years per plant. Cheap shale gas and onshore storage, low prices, fast demand growth, heat waves and winter storms. Its grid is an island too.',
      zh: { label: '\u5fb7\u5dde', hint: '\u6210\u9577\u5feb', blurb: '\u6c92\u6709\u78b3\u7a05\uff1a\u7f8e\u570b 45Q \u62b5\u6e1b\u6bcf\u5c01\u5b58\u4e00\u5678\u4ed8 85 \u7f8e\u5143\uff0c\u6bcf\u5ea7\u5ee0\u7d66 12 \u5e74\u3002\u9801\u5ca9\u6c23\u4fbf\u5b9c\u3001\u9678\u4e0a\u5c01\u5b58\u4fbf\u5b9c\u3001\u96fb\u50f9\u4f4e\u3001\u7528\u96fb\u6210\u9577\u5feb\uff0c\u6709\u71b1\u6d6a\u8207\u51ac\u5b63\u66b4\u98a8\u96ea\u3002\u96fb\u7db2\u4e5f\u662f\u5b64\u5cf6\u3002' },
    },
  };
  const RG = state => REGIONS[state.region] || REGIONS.taiwan;
  // monthly demand shape (Jan..Dec, mean 1): the usual seasonal swing of each grid, rounded
  const SEASON = (() => {
    const raw = {
      taiwan:  [0.90, 0.86, 0.93, 0.95, 1.02, 1.08, 1.15, 1.15, 1.08, 1.00, 0.95, 0.93],
      germany: [1.12, 1.08, 1.04, 0.96, 0.92, 0.89, 0.91, 0.91, 0.93, 0.99, 1.06, 1.11],
      texas:   [0.97, 0.90, 0.88, 0.88, 0.98, 1.10, 1.20, 1.22, 1.08, 0.95, 0.90, 0.95],
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
  const BREACH = { up: 10, down: 5, maxStep: 8 };    // % per month per 100 % over / under the limit (max +8 %/month)
  const PROVEN_MONTHS = 24;           // months of operation before a new technology stops failing
  const DEEP = { capture: 0.99, dutyMul: 1.09, opexAdd: 1, costFrac: 0.7, months: 12 };   // a costly, slow last resort

  // capexFactor: capture-unit cost per MW relative to coal; dutyMul/opexMul: dilute flue gas costs more per tonne.
  // heatRate: fuel per MWh relative to a combined-cycle plant burning the same gas (a converted boiler is less efficient)
  const PLANT_TYPES = {
    coal: { label: 'Coal', zh: '\u71c3\u7164', intensity: 0.95, fixed: 0.0030, capexFactor: 1.0, dutyMul: 1.0, opexMul: 1.0,
      size: 600, build: { cost: 900, months: 48 } },
    gas:  { label: 'Gas', zh: '\u71c3\u6c23', intensity: 0.37, fixed: 0.0020, capexFactor: 0.75, dutyMul: 1.15, opexMul: 1.2, gas: true,
      size: 400, build: { cost: 420, months: 27 } },
    gasb: { label: 'Gas-boiler', zh: '\u71c3\u6c23\u934b\u7210', intensity: 0.55, fixed: 0.0030, capexFactor: 0.9, dutyMul: 1.08, opexMul: 1.1, gas: true, heatRate: 1.45,
      size: 570, build: null },
  };
  // conversions, keyed by from -> to. A boiler fuel switch is quick and cheap but stays a steam cycle (0.55 t/MWh);
  // repowering to a combined cycle (0.37 t/MWh) is a two-year rebuild.
  const CONVERT = {
    coal: { gasb: { cost: 60, months: 6 }, gas: { cost: 450, months: 24 } },
    gasb: { gas: { cost: 400, months: 24 }, coal: { cost: 40, months: 6 } },
    gas: {},
  };

  // capture: fraction captured; duty: regeneration GJ/t; capex: \u00d7 CAPEX_SCALE $M per MW gross (coal basis); opex: $/t
  // rate: CO2 absorption speed relative to MEA. Build cost = half absorber + half the rest; packed height goes
  // roughly as 1/sqrt(rate), floored at 0.5. The rest: advanced stripper 1.3, viscous 2PE/EG 1.1, else 1.0.
  // stage: how far it has been scaled up; startup: monthly failure odds until proven; risk: forever (riskText says why)
  const TECHS = {
    mea90: {
      name: 'MEA', short: 'MEA', capture: 0.90, duty: 3.5, capex: 1.00, opex: 10, rate: 1,
      unlocked: true, color: '#5B8DEF', stage: 'Commercial', startup: 0,
      pitch: 'Proven and available now, but uses the most steam.',
      fact: '30 wt% MEA, the industry benchmark. Regeneration \u2248 3.5 GJ per tonne CO\u2082.',
      src: 'Chen, Wu & Lin, Chem. Eng. J. 2026',
      zh: { name: 'MEA', stage: '\u5546\u8f49', pitch: '\u6210\u719f\u3001\u73fe\u5728\u5c31\u80fd\u7528\uff0c\u4f46\u6700\u8017\u84b8\u6c7d\u3002', fact: '30 wt% MEA \u662f\u696d\u754c\u57fa\u6e96\u3002\u518d\u751f\u80fd\u8017\u7d04\u6bcf\u5678 CO\u2082 3.5 GJ\u3002' },
    },
    afs: {
      name: 'MEA + advanced stripper', short: 'MEA+AS', capture: 0.90, duty: 2.8, capex: 1.15, opex: 10, rate: 1,
      unlocked: false, research: { cost: 80, months: 12, process: true }, color: '#2BB3C0', stage: 'Pilot-tested', startup: 0.012,
      fail: 'the new stripper would not hold steady',
      pitch: 'Same MEA, smarter heat recovery: less steam, safe bet, pricier to build.',
      fact: 'A heat-integrated stripper cuts MEA regeneration to \u2248 2.8 GJ/t.',
      src: 'Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025',
      zh: { name: 'MEA + \u9032\u968e\u6c7d\u63d0', stage: '\u5df2\u524d\u5c0e\u6e2c\u8a66', fail: '\u65b0\u6c7d\u63d0\u5854\u4e00\u76f4\u7a69\u4e0d\u4e0b\u4f86', pitch: '\u540c\u6a23\u662f MEA\uff0c\u71b1\u56de\u6536\u66f4\u8070\u660e\uff1a\u7701\u84b8\u6c7d\u3001\u7a69\u5065\uff0c\u4f46\u6bd4\u8f03\u8cb4\u3002', fact: '\u71b1\u6574\u5408\u6c7d\u63d0\u5854\u628a MEA \u518d\u751f\u80fd\u8017\u964d\u5230\u7d04 2.8 GJ/t\u3002' },
    },
    rpb: {
      name: 'Rotating packed bed (70 wt% MEA)', short: 'RPB', capture: 0.90, duty: 3.0, capex: 0.65, opex: 12, rate: 10, work: 0.02, fast: true,
      unlocked: false, research: { cost: 90, months: 12, process: true }, color: '#F28482', est: ['capex', 'duty'], stage: 'Pilot (TRL 7)',
      startup: 0.02, risk: 0.004, fail: 'the rotor vibrated out of balance', riskText: 'a rotor bearing failed',
      pitch: 'A spinning absorber the size of a shipping container: cheap and twice as fast to build, but the rotors need care.',
      fact: 'The solvent is flung outward through a ring of packing spinning at about 50\u00d7 gravity. Thin, constantly renewed films absorb CO\u2082 so fast that the absorber is 10\u201320\u00d7 smaller, and it can run concentrated 70 wt% MEA. Catch: rotating machinery breaks down, each unit tops out near 0.1 Mt CO\u2082 a year so big plants need many, and the rotors use power.',
      src: 'Ind. Eng. Chem. Res. 2025 (doi 10.1021/acs.iecr.4c01614); Carbon Clean CycloneCC pilot, Ruwais 2024',
      zh: { name: '\u65cb\u8f49\u586b\u5145\u5e8a(70 wt% MEA)', stage: '\u524d\u5c0e(TRL 7)', fail: '\u8f49\u5b50\u5931\u8861\u5287\u70c8\u632f\u52d5', riskText: '\u8f49\u5b50\u8ef8\u627f\u6545\u969c',
        pitch: '\u8ca8\u6ac3\u5927\u5c0f\u7684\u65cb\u8f49\u5438\u6536\u5668\uff1a\u4fbf\u5b9c\u3001\u5de5\u671f\u5feb\u4e00\u500d\uff0c\u4f46\u8f49\u5b50\u8981\u5e38\u4fdd\u990a\u3002',
        fact: '\u6eb6\u5291\u88ab\u7529\u904e\u4ee5\u7d04 50 \u500d\u91cd\u529b\u9ad8\u901f\u65cb\u8f49\u7684\u586b\u6599\u74b0\uff0c\u6db2\u819c\u53c8\u8584\u53c8\u4e0d\u65b7\u66f4\u65b0\uff0c\u5438\u6536\u5feb\u5230\u5438\u6536\u5668\u53ea\u8981\u50b3\u7d71\u5854\u7684 1/10\u20131/20\uff0c\u9084\u80fd\u7528 70 wt% \u7684\u6fc3 MEA\u3002\u4ee3\u50f9\uff1a\u65cb\u8f49\u6a5f\u68b0\u6703\u6545\u969c\uff1b\u6bcf\u53f0\u4e0a\u9650\u7d04\u6bcf\u5e74 0.1 Mt CO\u2082\uff0c\u5927\u96fb\u5ee0\u8981\u5f88\u591a\u53f0\uff1b\u8f49\u5b50\u4e5f\u8981\u8017\u96fb\u3002' },
    },
    amp: {
      name: 'Aqueous AMP (30 wt%)', short: 'AMP', capture: 0.90, hiCap: true, duty: 3.25, capex: 1.4, opex: 12, rate: 0.56,
      unlocked: false, research: { cost: 60, months: 12, exp: 0.95, comp: 0.8 }, color: '#A3B18A', est: ['duty', 'opex'], stage: 'Pilot-tested',
      startup: 0.01, solvent: true, fail: 'AMP vapour escaped faster than the water wash could catch it',
      pitch: 'A trade-off, not an upgrade: twice the CO\u2082 per kilogram and a little less steam, but it absorbs slowly (tall, pricey absorber) and evaporates.',
      fact: '2-Amino-2-methyl-1-propanol is sterically hindered: it forms little carbamate, so it carries about twice the CO\u2082 of MEA per kilogram and gives it back with less heat (73 vs 82 kJ/mol). But it reacts about 10\u00d7 slower; in a wetted-wall column its overall absorption rate was 45 % below MEA, so the absorber needs about 1.8\u00d7 the packing. It is also about 3.5\u00d7 more volatile than MEA, so more amine escapes and must be replaced. Screening found something different, not something better: what you need decides whether it is worth it.',
      src: 'Chen, Closmann & Rochelle, Energy Procedia 2011 (doi 10.1016/j.egypro.2011.01.029); Le Li, PhD dissertation, UT Austin 2015; Luo et al., Sep. Purif. Technol. 2016',
      zh: { name: '30 wt% AMP \u6c34\u6eb6\u6db2', stage: '\u5df2\u524d\u5c0e\u6e2c\u8a66', fail: 'AMP \u84b8\u6c23\u9038\u6563\u5f97\u6bd4\u6c34\u6d17\u6bb5\u6536\u5f97\u9084\u5feb',
        pitch: '\u662f\u53d6\u6368\uff0c\u4e0d\u662f\u5347\u7d1a\uff1a\u6bcf\u516c\u65a4\u5e36\u8d70\u5169\u500d CO\u2082\u3001\u84b8\u6c7d\u7a0d\u7701\uff0c\u4f46\u5438\u6536\u6162(\u5438\u6536\u5854\u9ad8\u53c8\u8cb4)\uff0c\u800c\u4e14\u6703\u63ee\u767c\u3002',
        fact: '2-\u80fa\u57fa-2-\u7532\u57fa-1-\u4e19\u9187(AMP)\u662f\u7acb\u9ad4\u969c\u7919\u80fa\uff1a\u5e7e\u4e4e\u4e0d\u5f62\u6210\u80fa\u7532\u9178\u9e7d\uff0c\u6240\u4ee5\u6bcf\u516c\u65a4\u80fd\u5e36\u8d70\u7d04\u5169\u500d\u65bc MEA \u7684 CO\u2082\uff0c\u91cb\u653e\u6642\u7684\u71b1\u4e5f\u8f03\u5c11(73 vs 82 kJ/mol)\u3002\u4f46\u5b83\u7684\u53cd\u61c9\u6162\u7d04 10 \u500d\uff1b\u6fd5\u58c1\u5854\u5be6\u6e2c\u7684\u6574\u9ad4\u5438\u6536\u901f\u7387\u6bd4 MEA \u4f4e 45 %\uff0c\u5438\u6536\u5854\u8981\u7d04 1.8 \u500d\u7684\u586b\u6599\u3002\u5b83\u7684\u63ee\u767c\u6027\u4e5f\u7d04\u662f MEA \u7684 3.5 \u500d\uff0c\u8dd1\u6389\u7684\u80fa\u8981\u4e00\u76f4\u88dc\u3002\u7be9\u9078\u627e\u5230\u7684\u662f\u300c\u4e0d\u4e00\u6a23\u300d\uff0c\u4e0d\u662f\u300c\u66f4\u597d\u300d\uff1a\u503c\u4e0d\u503c\u5f97\uff0c\u770b\u4f60\u9700\u8981\u4ec0\u9ebc\u3002' },
    },
    mdeapz: {
      name: 'MDEA/PZ (activated MDEA)', short: 'MDEA/PZ', capture: 0.90, hiCap: true, duty: 3.1, capex: 0.88, opex: 10, rate: 1.8, work: 0.02,
      unlocked: false, research: { cost: 90, months: 18, exp: 0.9, comp: 0.7 }, color: '#4EA8DE', est: ['duty', 'capex', 'opex'], stage: 'Pilot-tested',
      startup: 0.012, solvent: true, fail: 'the blend foamed and carried over into the stripper',
      pitch: 'A tertiary amine sped up by piperazine: twice the capacity of MEA, no freeze-out, but MDEA breaks down above ~120 \u00b0C, so the stripper runs cooler and compression costs more.',
      fact: "MDEA is a tertiary amine: it cannot form carbamate, so it carries about 1.7\u20132\u00d7 the CO\u2082 of MEA per kilogram with a lower heat of absorption (68\u201370 vs 72\u201382 kJ/mol), but on its own it is far too slow for flue gas. At least 2 m of piperazine speeds it up to about 1.6\u20132\u00d7 MEA. Simulations and a 2025 pilot put its regeneration energy roughly 10\u201325 % below MEA (pilot: 3.4 vs 3.74 MJ/kg on the same rig). Catch: MDEA breaks down above about 120\u2013135 \u00b0C, so the stripper runs at lower pressure (6\u20137 bar vs 16.5 bar for PZ) and CO\u2082 compression costs more.",
      src: "Frailie, PhD dissertation, UT Austin 2014; Xi Chen, PhD dissertation, UT Austin 2011; Closmann, Nguyen & Rochelle, Energy Procedia 2009 (doi 10.1016/j.egypro.2009.01.177); J\u00f8rsboe et al., Fuel 2025 (doi 10.1016/j.fuel.2025.135296)",
      zh: { name: 'MDEA/PZ(\u6d3b\u5316 MDEA)', stage: '\u5df2\u524d\u5c0e\u6e2c\u8a66', fail: '\u6df7\u5408\u6eb6\u5291\u8d77\u6ce1\uff0c\u88ab\u5e36\u9032\u6c7d\u63d0\u5854',
        pitch: '\u7528\u54cc\u55ea\u52a0\u901f\u7684\u4e09\u7d1a\u80fa\uff1a\u5bb9\u91cf\u662f MEA \u7684\u5169\u500d\u3001\u4e0d\u6703\u6790\u51fa\uff0c\u4f46 MDEA \u8d85\u904e\u7d04 120 \u00b0C \u5c31\u6703\u5206\u89e3\uff0c\u6c7d\u63d0\u5854\u53ea\u80fd\u8dd1\u4f4e\u6eab\uff0c\u58d3\u7e2e\u5c31\u66f4\u8017\u96fb\u3002',
        fact: "MDEA \u662f\u4e09\u7d1a\u80fa\uff1a\u4e0d\u80fd\u5f62\u6210\u80fa\u7532\u9178\u9e7d\uff0c\u6240\u4ee5\u6bcf\u516c\u65a4\u80fd\u5e36\u8d70\u7d04 1.7\u20132 \u500d\u65bc MEA \u7684 CO\u2082\uff0c\u5438\u6536\u71b1\u4e5f\u8f03\u4f4e(68\u201370 vs 72\u201382 kJ/mol)\uff0c\u4f46\u55ae\u7368\u4f7f\u7528\u5c0d\u7159\u6c23\u592a\u6162\u3002\u52a0\u5165\u81f3\u5c11 2 m \u54cc\u55ea\u5f8c\uff0c\u901f\u5ea6\u63d0\u5347\u5230 MEA \u7684\u7d04 1.6\u20132 \u500d\u3002\u6a21\u64ec\u8207 2025 \u5e74\u524d\u5c0e\u5ee0\u986f\u793a\u518d\u751f\u80fd\u8017\u6bd4 MEA \u4f4e\u7d04 10\u201325 %(\u540c\u4e00\u5ea7\u524d\u5c0e\u5ee0\uff1a3.4 vs 3.74 MJ/kg)\u3002\u4ee3\u50f9\uff1aMDEA \u8d85\u904e\u7d04 120\u2013135 \u00b0C \u6703\u5206\u89e3\uff0c\u6c7d\u63d0\u5854\u53ea\u80fd\u5728\u8f03\u4f4e\u58d3\u529b\u904b\u8f49(6\u20137 bar\uff0cPZ \u53ef\u5230 16.5 bar)\uff0cCO\u2082 \u58d3\u7e2e\u66f4\u8017\u96fb\u3002" },
    },
    aas: {
      name: 'Amino-acid salt (K-sarcosinate)', short: 'AAS', capture: 0.90, duty: 3.7, capex: 1.02, opex: 8, rate: 1.16, gasDuty: 3.8, noEmit: true,
      unlocked: false, research: { cost: 70, months: 12, exp: 0.95, comp: 0.75 }, color: '#C9A227', est: ['duty', 'capex', 'opex'], stage: 'Pilot-tested',
      startup: 0.01, risk: 0.002, solvent: true, fail: 'salt crystals formed in the cold rich line', riskText: 'salt crystals clogged a line',
      pitch: 'Not better, just different: a salt that does not evaporate, so no amine in the air and no emission protests, but it holds less CO\u2082 and needs more steam on coal.',
      fact: "Potassium sarcosinate is the salt of an amino acid. Salts do not evaporate, so almost no amine reaches the air. But it holds only about 0.6\u00d7 the CO\u2082 of MEA per kilogram and can crystallise out. An independent pilot measured MORE regeneration energy than MEA; the vendor's advanced process (Siemens POSTCAP) claims 2.4\u20132.7 GJ/t. Lab tests also found that it oxidises: less than MEA, but it is not immune as advertised. It does relatively better on dilute gas-plant flue gas, where it absorbs about 1.6\u00d7 faster than MEA.",
      src: "Le Li, PhD dissertation, UT Austin 2015; Knuutila et al., Energy Procedia 2011 (doi 10.1016/j.egypro.2011.02.024); Jockenh\u00f6vel & Schneider, Energy Procedia 2011 (doi 10.1016/j.egypro.2011.02.011)",
      zh: { name: '\u80fa\u57fa\u9178\u9e7d(\u808c\u80fa\u9178\u9240)', stage: '\u5df2\u524d\u5c0e\u6e2c\u8a66', fail: '\u51b7\u7684\u5bcc\u6db2\u7ba1\u7dda\u6790\u51fa\u9e7d\u7d50\u6676', riskText: '\u9e7d\u7d50\u6676\u585e\u4f4f\u7ba1\u7dda',
        pitch: '\u4e0d\u662f\u66f4\u597d\uff0c\u53ea\u662f\u4e0d\u4e00\u6a23\uff1a\u9e7d\u985e\u4e0d\u6703\u63ee\u767c\uff0c\u7a7a\u6c23\u88e1\u6c92\u6709\u80fa\uff0c\u4e0d\u6703\u88ab\u6297\u8b70\u6392\u653e\uff1b\u4f46 CO\u2082 \u5bb9\u91cf\u8f03\u4f4e\uff0c\u7528\u5728\u71c3\u7164\u5ee0\u66f4\u8017\u84b8\u6c7d\u3002',
        fact: "\u808c\u80fa\u9178\u9240\u662f\u80fa\u57fa\u9178\u7684\u9e7d\u985e\u3002\u9e7d\u4e0d\u6703\u63ee\u767c\uff0c\u6240\u4ee5\u5e7e\u4e4e\u6c92\u6709\u80fa\u9032\u5230\u7a7a\u6c23\u88e1\u3002\u4f46\u5b83\u6bcf\u516c\u65a4\u53ea\u80fd\u5e36\u8d70\u7d04 0.6 \u500d\u65bc MEA \u7684 CO\u2082\uff0c\u800c\u4e14\u53ef\u80fd\u7d50\u6676\u6790\u51fa\u3002\u7368\u7acb\u524d\u5c0e\u5ee0\u91cf\u5230\u7684\u518d\u751f\u80fd\u8017\u53cd\u800c\u300c\u9ad8\u65bc\u300dMEA\uff1b\u5ee0\u5546\u7684\u9032\u968e\u6d41\u7a0b(Siemens POSTCAP)\u5ba3\u7a31 2.4\u20132.7 GJ/t\u3002\u5be6\u9a57\u5ba4\u4e5f\u767c\u73fe\u5b83\u6703\u6c27\u5316\uff1a\u6bd4 MEA \u5c11\uff0c\u4f46\u4e0d\u50cf\u5ba3\u50b3\u7684\u90a3\u6a23\u514d\u75ab\u3002\u5b83\u5728\u7a00\u8584\u7684\u71c3\u6c23\u5ee0\u7159\u6c23\u4e0a\u76f8\u5c0d\u8f03\u597d\uff0c\u5438\u6536\u901f\u5ea6\u7d04\u70ba MEA \u7684 1.6 \u500d\u3002" },
    },
    ampnmp: {
      name: 'AMP/NMP (semi-aqueous)', short: 'AMP/NMP', capture: 0.90, hiCap: true, duty: 3.0, capex: 1.45, opex: 6, rate: 0.3,
      unlocked: false, research: { cost: 100, months: 18, exp: 0.9, comp: 0.6 }, color: '#0E9F6E', est: ['duty', 'opex', 'capex'], stage: 'Lab scale',
      startup: 0.025, risk: 0.006, solvent: true, scaleUp: true, fail: 'AMP carbamate precipitated and clogged a line', riskText: 'AMP carbamate precipitated',
      pitch: 'Cheapest to run, but it absorbs slowly: the tallest absorber, the priciest to build, and it can clog.',
      fact: 'NMP does not react with CO\u2082; it makes the hindered amine AMP 3\u00d7 faster than in water, and AMP holds about twice the CO\u2082 of MEA, so only half the solvent has to circulate: smaller pumps and less make-up, the cheapest to run. Catch: AMP carbamate can precipitate at high loading and clog lines, even years after start-up.',
      src: 'Cheng, Chen & Lin, Chem. Eng. J. 2025',
      zh: { name: 'AMP/NMP(\u534a\u6c34\u6eb6\u6db2)', stage: '\u5be6\u9a57\u5ba4\u898f\u6a21', fail: 'AMP \u80fa\u7532\u9178\u9e7d\u6790\u51fa\u585e\u4f4f\u7ba1\u7dda', riskText: 'AMP \u80fa\u7532\u9178\u9e7d\u6790\u51fa',
        pitch: '\u904b\u8f49\u6700\u4fbf\u5b9c\uff0c\u4f46\u5438\u6536\u6162\uff1a\u5438\u6536\u5854\u6700\u9ad8\u3001\u6700\u8cb4\uff0c\u800c\u4e14\u6703\u5835\u585e\u3002',
        fact: 'NMP \u4e0d\u8ddf CO\u2082 \u53cd\u61c9\uff0c\u537b\u8b93\u7acb\u9ad4\u969c\u7919\u80fa AMP \u6bd4\u5728\u6c34\u4e2d\u5feb 3 \u500d\uff1bAMP \u7684 CO\u2082 \u5bb9\u91cf\u7d04\u662f MEA \u7684\u5169\u500d\uff0c\u6eb6\u5291\u5faa\u74b0\u91cf\u6e1b\u534a\uff1a\u6cf5\u6d66\u66f4\u5c0f\u3001\u88dc\u5145\u66f4\u5c11\uff0c\u904b\u8f49\u6700\u4fbf\u5b9c\u3002\u4ee3\u50f9\uff1a\u9ad8\u8ca0\u8f09\u6642 AMP \u80fa\u7532\u9178\u9e7d\u6703\u6790\u51fa\u5835\u7ba1\uff0c\u5373\u4f7f\u958b\u6a5f\u591a\u5e74\u5f8c\u4e5f\u6703\u767c\u751f\u3002' },
    },
    pe2eg: {
      name: '2PE/EG (water-lean)', short: '2PE/EG', capture: 0.90, hiCap: true, duty: 2.9, capex: 0.80, opex: 9, rate: 4.5,
      unlocked: false, research: { cost: 180, months: 24, exp: 0.85, comp: 0.5 }, color: '#E2A93B', est: ['capex'], star: true, stage: 'Lab scale',
      startup: 0.035, solvent: true, scaleUp: true, fail: 'the viscous solvent overloaded the heat exchanger',
      pitch: 'The rarest find and shaky first years, then fast, compact and efficient: the best all-rounder.',
      fact: 'Ethylene glycol reacts: it turns the carbamate into alkyl carbonate and frees the amine again, so 2-piperidineethanol gets both 4.5\u00d7 faster reaction and 2.8\u00d7 cyclic capacity vs MEA; regeneration 128 kJ/mol (\u2248 2.9 GJ/t). Catch: 15\u00d7 more viscous than MEA.',
      src: 'Chen, Wu & Lin, Chem. Eng. J. 2026',
      zh: { name: '2PE/EG(\u4f4e\u6c34\u6eb6\u5291)', stage: '\u5be6\u9a57\u5ba4\u898f\u6a21', fail: '\u9ecf\u7a20\u6eb6\u5291\u8b93\u71b1\u4ea4\u63db\u5668\u8d85\u8f09',
        pitch: '\u6700\u7a00\u6709\uff0c\u524d\u5e7e\u5e74\u4e0d\u7a69\uff0c\u4e4b\u5f8c\u53c8\u5feb\u3001\u53c8\u5c0f\u3001\u53c8\u7701\uff1a\u6700\u5168\u80fd\u3002',
        fact: '\u4e59\u4e8c\u9187\u6703\u53c3\u8207\u53cd\u61c9\uff1a\u628a\u80fa\u7532\u9178\u9e7d\u8f49\u6210\u70f7\u57fa\u78b3\u9178\u9e7d\u3001\u628a\u80fa\u91cb\u653e\u51fa\u4f86\uff0c\u6240\u4ee5 2-\u54cc\u5576\u4e59\u9187\u6bd4 MEA \u53cd\u61c9\u5feb 4.5 \u500d\u3001\u5faa\u74b0\u5bb9\u91cf 2.8 \u500d\uff1b\u518d\u751f 128 kJ/mol(\u7d04 2.9 GJ/t)\u3002\u4ee3\u50f9\uff1a\u9ecf\u5ea6\u662f MEA \u7684 15 \u500d\u3002' },
    },
    pz: {
      name: 'Piperazine (PZ) + advanced stripper', short: 'PZ+AS', capture: 0.90, hiCap: true, duty: 2.45, capex: 0.90, opex: 11, rate: 9.5,
      unlocked: false, research: { cost: 90, months: 18, exp: 0.95, comp: 0.7 }, color: '#8E7CC3', est: ['capex', 'opex'],
      stage: 'Pilot-tested', startup: 0.015, risk: 0.003, gasOK: true, solvent: true, fail: 'solid piperazine froze out in a cold line', riskText: 'solid piperazine froze out',
      pitch: 'Least steam in pilot plants, even on dilute gas-plant flue gas, and so fast the absorber is short; PZ is costly to buy and can freeze out when cold.',
      fact: 'Piperazine is the second-generation benchmark: fast, thermally stable, high capacity. With the advanced stripper, pilot plants measured a net 2.45 GJ per tonne CO\u2082 at 90 % capture, the same at 4 % (gas) and 12 % (coal) CO\u2082. Prof. Yu-Jeng Lin pilot-tested this stripper during his PhD. Catch: solid PZ can precipitate if the solvent gets too cold.',
      src: 'Suresh Babu & Rochelle, Int. J. Greenh. Gas Control 2021; Lin, Chen & Rochelle, Faraday Discuss. 2016',
      zh: { name: '\u54cc\u55ea(PZ)+ \u9032\u968e\u6c7d\u63d0', stage: '\u5df2\u524d\u5c0e\u6e2c\u8a66', fail: '\u56fa\u614b\u54cc\u55ea\u5728\u51b7\u7ba1\u7dda\u6790\u51fa', riskText: '\u56fa\u614b\u54cc\u55ea\u6790\u51fa',
        pitch: '\u524d\u5c0e\u5ee0\u5be6\u6e2c\u6700\u7701\u84b8\u6c7d\uff0c\u71c3\u6c23\u5ee0\u7a00\u8584\u7159\u6c23\u4e5f\u4e00\u6a23\u597d\uff0c\u53cd\u61c9\u5feb\u5230\u5438\u6536\u5854\u5f88\u77ee\uff1b\u4f46 PZ \u5f88\u8cb4\uff0c\u51b7\u4e86\u6703\u6790\u51fa\u3002',
        fact: '\u54cc\u55ea\u662f\u7b2c\u4e8c\u4ee3\u57fa\u6e96\u6eb6\u5291\uff1a\u5feb\u3001\u71b1\u7a69\u5b9a\u3001\u5bb9\u91cf\u9ad8\u3002\u642d\u914d\u9032\u968e\u6c7d\u63d0\uff0c\u524d\u5c0e\u5ee0\u5728 90 % \u6355\u6349\u7387\u4e0b\u5be6\u6e2c\u6de8\u80fd\u8017\u6bcf\u5678 CO\u2082 2.45 GJ\uff0c\u7159\u6c23 CO\u2082 4 %(\u71c3\u6c23)\u548c 12 %(\u71c3\u7164)\u90fd\u4e00\u6a23\u3002\u6797\u80b2\u6b63\u6559\u6388\u535a\u58eb\u73ed\u6642\u5c31\u5728\u524d\u5c0e\u5ee0\u6e2c\u8a66\u904e\u9019\u500b\u6c7d\u63d0\u5854\u3002\u4ee3\u50f9\uff1a\u6eb6\u5291\u592a\u51b7\u6642\u56fa\u614b PZ \u6703\u6790\u51fa\u3002' },
    },
    mcfc: {
      name: 'Carbonate fuel cell (MCFC)', short: 'MCFC', capture: 0.85, duty: 0, capex: 1.6, opex: 14, rate: null, power: 0.15,
      gasOnly: true, noDeep: true, stack: 84,
      unlocked: false, research: { cost: 120, months: 18, process: true }, color: '#E76F51', est: ['capex', 'opex'], stage: 'Demo (2026)',
      startup: 0.03, fail: 'a fuel-cell stack overheated',
      pitch: 'Captures CO\u2082 while making MORE power, but burns extra gas, stops at 85 %, fits gas plants only and its stacks wear out every 7 years.',
      fact: 'A molten-carbonate fuel cell sits in the flue gas and burns a little extra natural gas to make electricity. To run, it must pull CO\u2082 out of the flue gas and carry it across as carbonate ions, so the CO\u2082 comes out concentrated on the other side. On a gas plant it cuts CO\u2082 about 80 % while overall efficiency stays about the same. Catch: 650 \u00b0C stacks wear out, capture tops out near 85\u201390 %, and coal flue gas would poison it.',
      src: 'Campanari et al., Int. J. Greenh. Gas Control 2010; ExxonMobil & FuelCell Energy Rotterdam demonstration 2026',
      zh: { name: '\u78b3\u9178\u9e7d\u71c3\u6599\u96fb\u6c60(MCFC)', stage: '\u793a\u7bc4(2026)', fail: '\u71c3\u6599\u96fb\u6c60\u5806\u904e\u71b1',
        pitch: '\u6355\u6349 CO\u2082 \u7684\u540c\u6642\u9084\u300c\u591a\u767c\u96fb\u300d\uff0c\u4f46\u8981\u591a\u71d2\u5929\u7136\u6c23\u3001\u6355\u6349\u7387\u53ea\u5230 85 %\u3001\u53ea\u80fd\u88dd\u5728\u71c3\u6c23\u5ee0\uff0c\u96fb\u6c60\u5806\u6bcf 7 \u5e74\u8981\u63db\u3002',
        fact: '\u7194\u878d\u78b3\u9178\u9e7d\u71c3\u6599\u96fb\u6c60\u88dd\u5728\u7159\u9053\u4e0a\uff0c\u591a\u71d2\u4e00\u9ede\u5929\u7136\u6c23\u4f86\u767c\u96fb\uff1b\u5b83\u904b\u4f5c\u6642\u5fc5\u9808\u628a\u7159\u6c23\u88e1\u7684 CO\u2082 \u4ee5\u78b3\u9178\u6839\u96e2\u5b50\u7684\u5f62\u5f0f\u642c\u5230\u53e6\u4e00\u5074\uff0c\u6240\u4ee5 CO\u2082 \u5728\u53e6\u4e00\u5074\u8b8a\u5f97\u5f88\u6fc3\uff0c\u5bb9\u6613\u6536\u96c6\u3002\u88dd\u5728\u71c3\u6c23\u5ee0\u4e0a\u53ef\u6e1b\u5c11\u7d04 80 % CO\u2082\uff0c\u6574\u9ad4\u6548\u7387\u5e7e\u4e4e\u4e0d\u8b8a\u3002\u4ee3\u50f9\uff1a650 \u00b0C \u7684\u96fb\u6c60\u5806\u6703\u8001\u5316\uff0c\u6355\u6349\u7387\u4e0a\u9650\u7d04 85\u201390 %\uff0c\u71c3\u7164\u7159\u6c23\u6703\u6bd2\u5316\u5b83\u3002' },
    },
  };
  const TECH_ORDER = ['mea90', 'afs', 'rpb', 'amp', 'aas', 'mdeapz', 'pz', 'ampnmp', 'pe2eg', 'mcfc'];
  // Solvent screening: each campaign discovers ONE random solvent you do not have yet (rarer = better/newer).
  const METHODS = {
    exp: { label: 'Lab experiments', zh: '\u5be6\u9a57', cost: 150, months: 12, odds: 0.9 },
    comp: { label: 'Computer screening (QM + MD)', zh: '\u96fb\u8166\u7be9\u9078(QM + MD)', cost: 15, months: 4, odds: 0.4, learn: 0.15 },
  };
  const DROPS = { amp: { weight: 40, stars: 2 }, aas: { weight: 35, stars: 2 }, mdeapz: { weight: 30, stars: 3 }, pz: { weight: 28, stars: 3 }, ampnmp: { weight: 22, stars: 3 }, pe2eg: { weight: 16, stars: 4 } };
  // process upgrades: developed in one lab project, then fitted plant by plant
  const PROCESS = {
    ic: { cost: 50, months: 9, fit: 0.08, build: 6, hiCap: 0.9, other: 0.97 },   // absorber intercooling
    sf: { cost: 70, months: 12, fit: 0.15, build: 9, deep: 0.88 },              // split-flow + multi-pressure stripper (99 % only)
  };
  const PROJECTS = {
    ic: { name: 'Absorber intercooling', short: 'IC', cost: PROCESS.ic.cost, months: PROCESS.ic.months, process: true,
      desc: 'Pump the half-loaded solvent out of the middle of the absorber, cool it to 40 \u00b0C and send it back: it removes the temperature bulge that chokes high-capacity solvents. Best with AMP, AMP/NMP, MDEA/PZ, PZ and 2PE/EG (about \u221210 % steam); almost nothing for MEA (\u22123 %).',
      src: 'Chen, Hsu & Lin, Ind. Eng. Chem. Res. 2025 (AMP: solvent rate \u221239 %); Liu, Lu, Kuo & Lin, Ind. Eng. Chem. Res. 2025 (MEA: \u22123.8 %)',
      zh: { name: '\u5438\u6536\u5854\u4e2d\u9593\u51b7\u537b', desc: '\u628a\u5438\u6536\u5854\u4e2d\u6bb5\u7684\u534a\u5bcc\u6db2\u62bd\u51fa\u3001\u51b7\u5230 40 \u00b0C \u518d\u6253\u56de\u53bb\uff0c\u6d88\u9664\u6eab\u5ea6\u9f13\u5305\u5c0d\u9ad8\u5bb9\u91cf\u6eb6\u5291\u7684\u9650\u5236\u3002\u6700\u9069\u5408 AMP\u3001AMP/NMP\u3001MDEA/PZ\u3001PZ\u30012PE/EG(\u84b8\u6c7d\u7d04 \u221210 %)\uff1b\u5c0d MEA \u5e7e\u4e4e\u6c92\u7528(\u22123 %)\u3002' } },
    sf: { name: 'Split-flow, multi-pressure stripper', short: 'SF', cost: PROCESS.sf.cost, months: PROCESS.sf.months, process: true,
      desc: 'For 99 % capture: a semi-lean solvent does most of the work at the bottom of the absorber and a deeply stripped lean solvent polishes the top. Cuts the reboiler duty of 99 % capture by about 12 %, but needs more solvent circulation and an extra compressor stage. Only matters on plants upgraded to 99 %.',
      src: 'Chang, Chou & Lin, Sep. Purif. Technol. 2025 (doi 10.1016/j.seppur.2024.130120): reboiler 3.68 \u2192 3.25 GJ/t',
      zh: { name: '\u5206\u6d41 + \u591a\u58d3\u6c7d\u63d0', desc: '\u7d66 99 % \u6355\u6349\u7528\uff1a\u5438\u6536\u5854\u4e0b\u6bb5\u7528\u534a\u8ca7\u6db2\u6293\u5927\u90e8\u5206\uff0c\u4e0a\u6bb5\u7528\u6df1\u5ea6\u518d\u751f\u7684\u8ca7\u6db2\u6536\u5c3e\u300299 % \u6355\u6349\u7684\u518d\u6cb8\u5668\u8ca0\u8377\u7d04\u964d 12 %\uff0c\u4f46\u6eb6\u5291\u5faa\u74b0\u91cf\u66f4\u5927\u3001\u9084\u8981\u591a\u4e00\u6bb5\u58d3\u7e2e\u6a5f\u3002\u53ea\u5c0d\u5df2\u5347\u7d1a 99 % \u7684\u96fb\u5ee0\u6709\u7528\u3002' } },
    flex: { name: 'Flexible operation (control system)', short: 'FLEX', cost: 40, months: 8, process: true,
      desc: 'A control system that lets capture follow the grid: in the two or three peak months every capture unit eases off during the peak hours (75 % on average), so the plants give the town more power (fewer blackouts, more to sell), but more CO\u2082 escapes in those months. Works with every solvent; it starts OFF, switch it on in the lab.',
      src: 'Lin, Wong, Jang & Ou, AIChE J. 2012 (doi 10.1002/aic.12789): flexible operation of amine capture',
      zh: { name: '\u5f48\u6027\u64cd\u4f5c(\u63a7\u5236\u7cfb\u7d71)', desc: '\u8b93\u6355\u6349\u8ddf\u8457\u96fb\u7db2\u8d70\u7684\u63a7\u5236\u7cfb\u7d71\uff1a\u5728\u5169\u4e09\u500b\u5c16\u5cf0\u6708\u4efd\uff0c\u6bcf\u5957\u6355\u6349\u5728\u5c16\u5cf0\u6642\u6bb5\u964d\u8f09(\u6574\u6708\u5e73\u5747 75 %)\uff0c\u96fb\u5ee0\u591a\u51fa\u96fb\u529b(\u5c11\u505c\u96fb\u3001\u591a\u8ce3\u96fb)\uff0c\u4f46\u90a3\u5e7e\u500b\u6708\u6703\u591a\u6392\u4e00\u4e9b CO\u2082\u3002\u9069\u7528\u6240\u6709\u6eb6\u5291\uff1b\u9810\u8a2d\u95dc\u9589\uff0c\u8981\u5230\u7814\u7a76\u6240\u6253\u958b\u3002' } },
  };
  const LAB_ORDER = ['screen', 'afs', 'rpb', 'mcfc', 'ic', 'sf', 'flex'];   // one project at a time, more can queue

  // ---- names in both languages ----------------------------------------------
  const pName = p => `${PLANT_TYPES[p.type].label} Plant ${p.id}`;
  const pZh = p => `${PLANT_TYPES[p.type].zh}\u96fb\u5ee0 ${p.id}`;
  const tZh = id => (TECHS[id].zh && TECHS[id].zh.name) || TECHS[id].name;

  // ---- technology helpers -----------------------------------------------------
  function eff(techId, deep, type, ic, sf) {
    const t = TECHS[techId];
    if (!t) return null;
    const pt = PLANT_TYPES[type || 'coal'];
    const e = { capture: t.capture, duty: t.duty, opex: t.opex, work: t.work || 0, power: t.power || 0 };
    if (deep) { e.capture = DEEP.capture; e.duty *= DEEP.dutyMul; e.opex += DEEP.opexAdd; }
    if (t.gasDuty && pt.gas) e.duty = t.gasDuty * (deep ? DEEP.dutyMul : 1);   // e.g. an amino-acid salt suits dilute gas flue gas
    else if (!t.gasOK) e.duty *= pt.dutyMul;   // PZ + advanced stripper performs the same on dilute gas-plant flue gas
    if (ic && !t.power) e.duty *= t.hiCap ? PROCESS.ic.hiCap : PROCESS.ic.other;   // intercooling pays off for high-capacity solvents
    if (sf && deep && !t.power) e.duty *= PROCESS.sf.deep;                       // split flow trims the 99 % duty
    e.opex *= pt.opexMul;
    return e;
  }
  // energy (MWh_e) lost per tonne CO2 captured
  function workPerTonne(e) { return e.duty * GJ_TO_MWH_E + COMPRESS + (e.work || 0); }
  // share of gross output lost to capture (negative = the unit adds power, like a fuel cell)
  function penalty(plant, techId, deep) {
    if (deep === undefined) deep = !!plant.deep && plant.tech === techId;
    const e = eff(techId, deep, plant.type, plant.ic, plant.sf);
    if (!e) return 0;
    return PLANT_TYPES[plant.type].intensity * e.capture * workPerTonne(e) - e.power;
  }
  function capexFull(plant, techId) {
    return TECHS[techId].capex * CAPEX_SCALE * plant.gross * PLANT_TYPES[plant.type].capexFactor;
  }
  // first-of-a-kind premium: the first unit of a technology costs more, the third and later the base price
  function foak(state, techId) { return FOAK[Math.min(FOAK.length - 1, (state.built && state.built[techId]) || 0)]; }
  function installCost(state, plant, techId) {
    const full = capexFull(plant, techId) * foak(state, techId);
    let c = plant.tech ? 0.35 * full : full;   // an existing capture unit is retrofitted with a new solvent
    if (state.subsidy > 0) c *= 0.7;
    c *= RG(state).capexMul || 1;
    return Math.round(c);
  }
  function installMonths(plant, techId) {
    const fast = techId && TECHS[techId] && TECHS[techId].fast;
    return plant.tech ? (fast ? 2 : 4) : (fast ? 6 : 12);
  }
  function upgradeCost(state, plant) {
    let c = DEEP.costFrac * capexFull(plant, plant.tech);
    if (state.subsidy > 0) c *= 0.7;
    c *= RG(state).capexMul || 1;
    return Math.round(c);
  }
  // carbon price path: linear between the listed years, nothing before the first one
  function taxFor(region, year) {
    const t = (REGIONS[region] || REGIONS.taiwan).tax;
    if (!t || year < t[0][0]) return 0;
    for (let i = 1; i < t.length; i++) {
      if (year <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return Math.round(y0 + (y1 - y0) * (year - x0) / (x1 - x0)); }
    }
    return t[t.length - 1][1];
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
  function breachStep(ratio) {
    return ratio > 1 ? Math.min(BREACH.maxStep, BREACH.up * (ratio - 1)) : -BREACH.down * (1 - ratio);
  }
  function gasFuel(state) { return RG(state).gas * state.gasIndex * state.gasMult; }
  // fuel cost per MWh of output for a plant type in this region
  function fuelOf(state, type) {
    const pt = PLANT_TYPES[type];
    return pt.gas ? gasFuel(state) * (pt.heatRate || 1) : RG(state).coal;
  }
  const isGas = type => !!(PLANT_TYPES[type] && PLANT_TYPES[type].gas);
  // flexible operation: in the two or three peak months capture eases off during the peak hours (75 % on average
  // over the month). It has to be switched on after the research, so nobody pays the extra CO2 by accident.
  const FLEX = 0.75;
  function isPeak(state) { return seasonOf(state) >= 1.08 || state.demandMult > 1; }
  function flexNow(state) { return !!(state.unlocked.flex && state.flexOn === true && isPeak(state)); }
  function setFlex(state, on) { state.flexOn = !!on; }
  function online(p) { return p.down <= 0 && !(p.build && (p.build.kind === 'new' || p.build.kind === 'convert')); }

  function maturity(state, techId) {
    const t = TECHS[techId];
    const exp = state.exp[techId] || 0;
    const proven = !t.startup || exp >= PROVEN_MONTHS;
    // how it was found: lab-tested solvents fail half as often at start-up, computer predictions 1.5\u00d7 as often
    const how = state.foundBy && state.foundBy[techId];
    const risk = proven ? 0 : t.startup * (how === 'comp' ? 1.5 : how === 'exp' ? 0.5 : 1);
    return { stage: t.stage, exp, proven, risk, needs: PROVEN_MONTHS };
  }

  function project(id) {
    if (id === 'screen') return { id, name: 'Solvent screening', short: 'screening', cost: METHODS.exp.cost, months: METHODS.exp.months,
      desc: 'Finds one new solvent you do not have yet (rarer = better). Lab experiments are 10\u00d7 dearer but almost always work, and a lab-tested solvent fails half as often at start-up. QM + MD computer screening, like our GHGT-18 poster, is fast and cheap but can miss, and its finds are predictions: 1.5\u00d7 the start-up failures until proven.',
      zh: { name: '\u6eb6\u5291\u7be9\u9078', desc: '\u6bcf\u6b21\u627e\u5230\u4e00\u7a2e\u4f60\u9084\u6c92\u6709\u7684\u65b0\u6eb6\u5291(\u8d8a\u7a00\u6709\u8d8a\u597d)\u3002\u5be6\u9a57\u8cb4 10 \u500d\u4f46\u5e7e\u4e4e\u90fd\u6703\u6210\u529f\uff0c\u5be6\u9a57\u9a57\u8b49\u904e\u7684\u6eb6\u5291\u958b\u6a5f\u6545\u969c\u7387\u6e1b\u534a\u3002QM + MD \u96fb\u8166\u7be9\u9078(\u5c31\u662f\u6211\u5011 GHGT-18 \u6d77\u5831\u7684\u65b9\u6cd5)\u53c8\u5feb\u53c8\u4fbf\u5b9c\u4f46\u53ef\u80fd\u843d\u7a7a\uff0c\u627e\u5230\u7684\u53ea\u662f\u9810\u6e2c\uff1a\u6210\u719f\u524d\u958b\u6a5f\u6545\u969c\u7387 1.5 \u500d\u3002' } };
    if (PROJECTS[id]) return Object.assign({ id }, PROJECTS[id]);
    const t = TECHS[id];
    return { id, name: t.name, short: t.short, cost: t.research.cost, months: t.research.months, star: t.star,
      desc: t.pitch, solvent: t.solvent, process: !!t.research.process, zh: { name: tZh(id), desc: t.zh ? t.zh.pitch : t.pitch } };
  }
  const methodOf = (id, method) => id !== 'screen' ? 'exp' : (METHODS[method] ? method : 'exp');
  const undiscovered = state => Object.keys(DROPS).filter(k => !state.unlocked[k]);
  // each solvent already found makes the next screen 30 % dearer: the easy candidates go first
  function researchCost(state, id, method) {
    const found = Object.keys(DROPS).length - undiscovered(state).length;
    const base = id === 'screen' ? METHODS[methodOf(id, method)].cost * (1 + 0.3 * found) : project(id).cost;
    return Math.round(base * (state.resCut > 0 ? 1.5 : 1));
  }
  function researchMonths(state, id, method) { return id === 'screen' ? METHODS[methodOf(id, method)].months : project(id).months; }
  function researchOdds(state, id, method) {
    if (id !== 'screen') return 1;
    const mt = methodOf(id, method);
    const learned = mt === 'comp' ? METHODS.comp.learn * ((state.tries && state.tries.screen) || 0) : 0;
    return Math.min(0.95, METHODS[mt].odds + learned);
  }
  function drawSolvent(state, R) {
    const pool = undiscovered(state);
    const total = pool.reduce((a, k) => a + DROPS[k].weight, 0);
    let x = R() * total;
    for (const k of pool) { x -= DROPS[k].weight; if (x <= 0) return k; }
    return pool[pool.length - 1];
  }

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
    const p = { id, type, gross: PLANT_TYPES[type].size,
      tech: null, deep: false, build: null, queue: [], outage: 0, down: 0, downWhy: '', washed: false, capMonths: 0, stackAge: 0 };
    p.name = pName(p);
    return p;
  }
  function newGame(seed, region) {
    region = REGIONS[region] ? region : 'taiwan';
    const unlocked = {};
    TECH_ORDER.forEach(id => { unlocked[id] = !!TECHS[id].unlocked; });
    const four = region !== 'taiwan';
    return {
      seed: seed || Math.floor(Math.random() * 1e9),
      region, m: 0, funds: START_FUNDS, price: REGIONS[region].fair, cumCO2: 0, captured: 0, anger: 10,
      greenhouse: 0, maxDebt: 0, rate: 0, recent: [], overMonths: 0, wasOver: false,
      over: null, subsidy: 0, resCut: 0, opexCut: 0, usCut: false, headline: null, headlineN: 0, labQueue: [], captureOff: 0, captureOffWhy: '', lngCut: 0, shipMonths: 0, gasFreeze: 0,
      warnedYear: 0, sold: 0, soldTotal: 0, imported: 0, creditPaid: 0, taxPaid: 0, tsPaid: 0, built: {},
      angerParts: null, angerEvt: 0,
      plants: four
        ? [makePlant('A', 'coal'), makePlant('B', 'coal'), makePlant('C', 'gas'), makePlant('D', 'gas')]
        : [makePlant('A', 'coal'), makePlant('B', 'coal'), makePlant('C', 'gas')],
      nextId: four ? 4 : 3, unlocked, research: {}, resMethod: {}, tries: {}, exp: {},
      demandMult: 1, demandMonths: 0, gasMult: 1, gasMonths: 0, gasIndex: 1,
      pending: null, flash: null, flashN: 0, seen: {}, fails: 0, blackouts: 0, discovery: null,
      news: [{ m: 0, kind: 'info', text: 'You run the power utility of Capture City. Keep the lights on until 2050 and stay under the CO\u2082 limit.', zh: '\u4f60\u7d93\u71df\u6355\u6349\u57ce\u7684\u96fb\u529b\u516c\u53f8\u3002\u6490\u5230 2050 \u5e74\u4e0d\u505c\u96fb\uff0c\u800c\u4e14\u6392\u653e\u4e0d\u8d85\u904e CO\u2082 \u9650\u984d\u3002' }],
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
  function addNews(state, kind, text, zh) {
    state.news.unshift({ m: state.m, kind, text, zh });
    if (state.news.length > 30) state.news.pop();
  }
  function flash(state, kind, text, zh) {
    state.flashN += 1;
    state.flash = { n: state.flashN, kind, text, zh };
  }
  function angry(state, n) { state.anger = Math.min(100, state.anger + n); state.angerEvt = (state.angerEvt || 0) + n; }
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const findPlant = (state, id) => state.plants.find(x => x.id === id);

  // ---- player actions -------------------------------------------------------
  // `paid` = the job was already paid for when it was queued, so skip the funds check and the charge
  function techFits(plant, techId, deep) {
    const t = TECHS[techId];
    if (t.gasOnly && plant.type !== 'gas') return 'Gas (combined-cycle) plants only';
    return null;
  }
  // scale-up: a lab-scale solvent goes on ONE plant first and spreads only once it is proven (24 months running)
  function scaleUpBlock(state, plant, techId) {
    const t = TECHS[techId];
    if (!t.scaleUp || maturity(state, techId).proven) return null;
    const onIt = state.plants.filter(q => q !== plant && planned(q).tech === techId).length;
    return onIt ? 'Prove it on one plant first (2 years)' : null;
  }
  function canInstall(state, plant, techId, paid) {
    if (!TECHS[techId]) return { ok: false, why: 'Unknown technology' };
    if (!state.unlocked[techId]) return { ok: false, why: 'Research it first' };
    if (plant.build) return { ok: false, why: 'Construction in progress' };
    if (plant.tech === techId) return { ok: false, why: 'Already installed' };
    const fit = techFits(plant, techId) || scaleUpBlock(state, plant, techId);
    if (fit) return { ok: false, why: fit };
    const cost = installCost(state, plant, techId);
    if (!paid && state.funds < cost) return { ok: false, why: 'Not enough funds', cost };
    return { ok: true, cost, months: installMonths(plant, techId) };
  }
  function install(state, plantId, techId, paid) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canInstall(state, p, techId, paid != null);
    if (!chk.ok) return chk;
    const cost = paid != null ? paid : chk.cost;
    if (paid == null) state.funds -= cost;
    state.built[techId] = (state.built[techId] || 0) + 1;
    p.build = { kind: 'tech', tech: techId, deep: false, left: chk.months, total: chk.months, paid: cost };
    addNews(state, 'build', `${p.name}: ${TECHS[techId].short} capture construction started ($${cost}M, ${chk.months} months).`,
      `${pZh(p)}\uff1a\u958b\u59cb\u8208\u5efa ${TECHS[techId].short} \u6355\u6349\u8a2d\u5099($${cost}M\uff0c${chk.months} \u500b\u6708)\u3002`);
    return chk;
  }
  function canUpgrade(state, plant, paid) {
    if (!plant.tech) return { ok: false, why: 'Add capture first' };
    if (TECHS[plant.tech].noDeep) return { ok: false, why: 'Fuel cells cannot reach 99 %' };
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
    addNews(state, 'build', `${p.name}: 99 % capture upgrade started ($${cost}M).`, `${pZh(p)}\uff1a\u958b\u59cb\u5347\u7d1a\u5230 99 % \u6355\u6349($${cost}M)\u3002`);
    return chk;
  }
  const convertOptions = type => Object.keys(CONVERT[type] || {});
  function canConvert(state, plant, to, paid) {
    to = to || convertOptions(plant.type)[0];
    const c = to && CONVERT[plant.type] && CONVERT[plant.type][to];
    if (!c) return { ok: false, why: 'No conversion for this plant', to };
    if (plant.build) return { ok: false, why: 'Construction in progress', to };
    if (plant.tech && TECHS[plant.tech].gasOnly && to !== 'gas') return { ok: false, why: 'Remove the fuel cell first', to };
    if (!paid && state.funds < c.cost) return { ok: false, why: 'Not enough funds', to, cost: c.cost };
    return { ok: true, to, cost: c.cost, months: c.months };
  }
  function convert(state, plantId, to, paid) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    if (typeof to === 'number') { paid = to; to = undefined; }   // old call shape convert(state, id, paid)
    const chk = canConvert(state, p, to, paid != null);
    if (!chk.ok) return chk;
    const cost = paid != null ? paid : chk.cost;
    if (paid == null) state.funds -= cost;
    p.build = { kind: 'convert', toType: chk.to, left: chk.months, total: chk.months, paid: cost };
    addNews(state, 'build', `${p.name}: conversion to ${PLANT_TYPES[chk.to].label.toLowerCase()} started ($${cost}M, offline ${chk.months} months).`,
      `${pZh(p)}\uff1a\u958b\u59cb\u6539\u5efa\u70ba${PLANT_TYPES[chk.to].zh}($${cost}M\uff0c\u505c\u6a5f ${chk.months} \u500b\u6708)\u3002`);
    return chk;
  }

  // ---- work queues (like training units in a strategy game): paid when queued, refunded when cancelled ----
  const QUEUE_MAX = 5;
  const qOf = p => p.queue || (p.queue = []);
  function planned(plant) {
    const v = { type: plant.type, gross: plant.gross, tech: plant.tech, deep: plant.deep, ic: !!plant.ic, sf: !!plant.sf };
    const apply = job => {
      if (!job) return;
      if (job.kind === 'tech') { v.tech = job.tech; v.deep = false; }
      else if (job.kind === 'deep') v.deep = true;
      else if (job.kind === 'convert') { v.type = job.toType; v.gross = PLANT_TYPES[job.toType].size; }
      else if (job.kind === 'ic') v.ic = true;
      else if (job.kind === 'sf') v.sf = true;
    };
    apply(plant.build);
    qOf(plant).forEach(apply);
    return v;
  }
  function canQueue(state, plant, job) {
    if (qOf(plant).length >= QUEUE_MAX) return { ok: false, why: `Queue full (${QUEUE_MAX})` };
    const v = planned(plant);
    let cost, months, to;
    if (job.kind === 'tech') {
      if (!TECHS[job.tech]) return { ok: false, why: 'Unknown technology' };
      if (!state.unlocked[job.tech]) return { ok: false, why: TECHS[job.tech].solvent ? 'Find it by solvent screening' : 'Develop it in the lab first' };
      if (v.tech === job.tech) return { ok: false, why: plant.tech === job.tech && !plant.build && !qOf(plant).length ? 'Already installed' : 'Already queued' };
      const fit = techFits(v, job.tech) || scaleUpBlock(state, plant, job.tech);
      if (fit) return { ok: false, why: fit };
      cost = installCost(state, v, job.tech); months = installMonths(v, job.tech);
    } else if (job.kind === 'deep') {
      if (!v.tech) return { ok: false, why: 'Add capture first' };
      if (TECHS[v.tech].noDeep) return { ok: false, why: 'Fuel cells cannot reach 99 %' };
      if (v.deep) return { ok: false, why: plant.deep && !plant.build ? 'Already at 99 %' : 'Already queued' };
      cost = upgradeCost(state, v); months = DEEP.months;
    } else if (job.kind === 'convert') {
      to = job.to || convertOptions(v.type)[0];
      const c = to && CONVERT[v.type] && CONVERT[v.type][to];
      if (!c) return { ok: false, why: 'No conversion for this plant' };
      if (v.tech && TECHS[v.tech].gasOnly && to !== 'gas') return { ok: false, why: 'Remove the fuel cell first' };
      cost = c.cost; months = c.months;
    } else if (job.kind === 'ic' || job.kind === 'sf') {
      const pr = PROCESS[job.kind];
      if (!state.unlocked[job.kind]) return { ok: false, why: 'Develop it in the lab first' };
      if (!v.tech) return { ok: false, why: 'Add capture first' };
      if (TECHS[v.tech].power) return { ok: false, why: 'Not for fuel cells' };
      if (v[job.kind]) return { ok: false, why: plant[job.kind] && !plant.build ? 'Already installed' : 'Already queued' };
      if (job.kind === 'sf' && !v.deep) return { ok: false, why: 'Needs the 99 % upgrade first' };
      cost = Math.round(pr.fit * capexFull(v, v.tech) * (state.subsidy > 0 ? 0.7 : 1) * (RG(state).capexMul || 1)); months = pr.build;
    } else return { ok: false, why: 'Unknown job' };
    if (state.funds < cost) return { ok: false, why: 'Not enough funds', cost, months, to };
    return { ok: true, cost, months, to };
  }
  function jobName(job) {
    return job.kind === 'tech' ? `${TECHS[job.tech].short} capture` : job.kind === 'deep' ? '99 % upgrade' : job.kind === 'ic' ? 'absorber intercooling'
      : job.kind === 'sf' ? 'split-flow stripper' : `conversion to ${PLANT_TYPES[job.toType].label.toLowerCase()}`;
  }
  function jobZh(job) {
    return job.kind === 'tech' ? `${TECHS[job.tech].short} \u6355\u6349` : job.kind === 'deep' ? '99 % \u5347\u7d1a' : job.kind === 'ic' ? '\u5438\u6536\u5854\u4e2d\u9593\u51b7\u537b'
      : job.kind === 'sf' ? '\u5206\u6d41\u6c7d\u63d0' : `\u6539\u5efa\u70ba${PLANT_TYPES[job.toType].zh}`;
  }
  // fit a process upgrade (the capture unit keeps running while it is built)
  function addon(state, p, item) {
    const chk = canQueue(state, Object.assign({}, p, { queue: [] }), { kind: item.kind });
    if (!chk.ok && chk.why !== 'Not enough funds') return chk;
    p.build = { kind: item.kind, left: item.months, total: item.months, paid: item.paid };
    addNews(state, 'build', `${p.name}: ${jobName(item)} started ($${item.paid}M).`, `${pZh(p)}\uff1a\u958b\u59cb\u52a0\u88dd${jobZh(item)}($${item.paid}M)\u3002`);
    return { ok: true };
  }
  function enqueue(state, plantId, job) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    const chk = canQueue(state, p, job);
    if (!chk.ok) return chk;
    state.funds -= chk.cost;
    const item = { kind: job.kind, tech: job.tech, toType: chk.to, paid: chk.cost, months: chk.months };
    if (!p.build && !qOf(p).length) startJob(state, p, item);
    else {
      qOf(p).push(item);
      addNews(state, 'build', `${p.name}: ${jobName(item)} queued ($${chk.cost}M paid).`, `${pZh(p)}\uff1a${jobZh(item)}\u5df2\u6392\u5165\u4f47\u5217(\u5df2\u4ed8 $${chk.cost}M)\u3002`);
    }
    return chk;
  }
  function startJob(state, p, item) {
    const r = item.kind === 'tech' ? install(state, p.id, item.tech, item.paid)
      : item.kind === 'deep' ? upgrade(state, p.id, item.paid)
      : item.kind === 'ic' || item.kind === 'sf' ? addon(state, p, item) : convert(state, p.id, item.toType, item.paid);
    if (!r.ok) {
      state.funds += item.paid;
      addNews(state, 'build', `${p.name}: ${jobName(item)} skipped (${r.why.toLowerCase()}), $${item.paid}M refunded.`,
        `${pZh(p)}\uff1a${jobZh(item)}\u7121\u6cd5\u958b\u5de5\uff0c\u9000\u9084 $${item.paid}M\u3002`);
    }
    return r;
  }
  function cancelJob(state, plantId, index) {
    const p = findPlant(state, plantId);
    if (!p) return { ok: false, why: 'No such plant' };
    if (index === 0) {
      if (!p.build || p.build.kind === 'new') return { ok: false, why: 'Nothing to cancel' };
      const back = p.build.paid || 0;
      state.funds += back;
      if (p.build.kind === 'tech' && state.built[p.build.tech]) state.built[p.build.tech] -= 1;
      addNews(state, 'build', `${p.name}: ${jobName(p.build)} cancelled, $${back}M refunded.`, `${pZh(p)}\uff1a\u53d6\u6d88${jobZh(p.build)}\uff0c\u9000\u9084 $${back}M\u3002`);
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

  function canQueueResearch(state, id, method) {
    const lq = state.labQueue || (state.labQueue = []);
    if (lq.length >= QUEUE_MAX) return { ok: false, why: `Queue full (${QUEUE_MAX})` };
    if (id === 'screen') {
      const n = lq.filter(x => x.id === 'screen').length + (state.research.screen != null ? 1 : 0);
      if (n >= undiscovered(state).length) return { ok: false, why: undiscovered(state).length ? 'Enough screens queued' : 'Every solvent found' };
    } else {
      if (!PROJECTS[id] && (!TECHS[id] || !TECHS[id].research)) return { ok: false, why: 'Nothing to research' };
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
    const pr = project(id);
    addNews(state, 'lab', `${id === 'screen' ? METHODS[chk.method].label : pr.name} queued ($${chk.cost}M paid).`,
      `${id === 'screen' ? METHODS[chk.method].zh : pr.zh.name}\u5df2\u6392\u5165\u4f47\u5217(\u5df2\u4ed8 $${chk.cost}M)\u3002`);
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
      if (!r.ok) {
        state.funds += item.paid;
        addNews(state, 'lab', `Queued lab project skipped (${r.why.toLowerCase()}), $${item.paid}M refunded.`, `\u6392\u968a\u4e2d\u7684\u7814\u767c\u5c08\u6848\u7121\u6cd5\u958b\u59cb\uff0c\u9000\u9084 $${item.paid}M\u3002`);
      }
    }
  }
  function canBuildPlant(state, type) {
    const b = PLANT_TYPES[type] && PLANT_TYPES[type].build;
    if (!b) return { ok: false, why: 'Cannot build this type' };
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
    addNews(state, 'build', `${p.name} under construction ($${chk.cost}M, ${chk.months} months).`, `${pZh(p)}\u958b\u59cb\u8208\u5efa($${chk.cost}M\uff0c${chk.months} \u500b\u6708)\u3002`);
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
    addNews(state, 'build', `${p.name} demolished ($${DEMOLISH_COST}M)${back ? `, $${back}M of queued work refunded` : ''}.`,
      `${pZh(p)}\u5df2\u62c6\u9664($${DEMOLISH_COST}M)${back ? `\uff0c\u9000\u9084\u6392\u968a\u5de5\u7a0b $${back}M` : ''}\u3002`);
    return chk;
  }
  function canResearch(state, id, method, paid) {
    if (id === 'screen') { if (!undiscovered(state).length) return { ok: false, why: 'Every solvent found' }; }
    else if (!PROJECTS[id] && (!TECHS[id] || !TECHS[id].research)) return { ok: false, why: 'Nothing to research' };
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
    const odds = Math.round(researchOdds(state, id, mt) * 100);
    if (id === 'screen') addNews(state, 'lab', `${METHODS[mt].label} started ($${cost}M, ${state.research[id]} months, ${odds} % chance to find a solvent).`,
      `${METHODS[mt].zh}\u958b\u59cb($${cost}M\uff0c${state.research[id]} \u500b\u6708\uff0c\u627e\u5230\u6eb6\u5291\u6a5f\u7387 ${odds} %)\u3002`);
    else addNews(state, 'lab', `Development of ${pr.name} started ($${cost}M, ${state.research[id]} months).`,
      `\u958b\u59cb\u7814\u767c${pr.zh.name}($${cost}M\uff0c${state.research[id]} \u500b\u6708)\u3002`);
    return chk;
  }
  function setPrice(state, price) { state.price = Math.max(40, Math.min(240, Math.round(price))); }

  // ---- events -----------------------------------------------------------------
  const CFG = { P_CHOICE: 0.010, P_FORCED: 0.014, GAP: 12 };   // \u2248 4\u20135 events a game, never two within a year
  const SHIP = { months: 4, perTonne: 40 };   // backup CO2 shipping while the storage site is reviewed ($/t extra)
  function capturing(state) {
    return state.plants.filter(p => p.tech && online(p) && p.outage <= 0);
  }
  function offCost(state, months) {
    const L = state.last;
    if (!L) return { extra: 0, rise: 0 };
    const extra = L.captured / 1e6 * months;
    const monthly = (L.emitted + L.captured) / 1e6;
    const rise = Math.min(100, breachStep(monthly / (limit(state) / 12)) * months);
    return { extra, rise: Math.max(0, rise) };
  }
  function offText(state, months, zh) {
    const o = offCost(state, months);
    if (zh) return `\u7d04 +${f1(o.extra)} Mt CO\u2082\uff0c` + (o.rise > 0.5 ? `\u8d85\u6a19\u8a08\u91cf +${Math.round(o.rise)} %` : '\u4ecd\u5728\u9650\u984d\u5167');
    return `\u2248 +${f1(o.extra)} Mt CO\u2082, ` + (o.rise > 0.5 ? `breach meter +${Math.round(o.rise)} %` : 'still under the limit');
  }
  function offerChoice(state, R) {
    const cap = capturing(state);
    const untreated = cap.filter(p => !p.washed);
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
    if (untreated.length && !state.seen.nox) pool.push('nox');
    if (!pool.length) return;
    const id = pool[Math.floor(R() * pool.length)];
    state.seen[id] = (state.seen[id] || 0) + 1;
    if (id === 'heat') {
      state.demandMult = 1.12; state.demandMonths = 3;
      const cold = rg.peak === 'cold';
      if (!cap.length || state.captureOff > 0) {
        headline(state, cold ? 'cold' : 'heat', 'bad',
          { title: cold ? 'Cold snap grips the city' : 'Heat wave grips the city', deck: 'Power demand +12 % for three months',
            text: cold ? 'Electric heaters run day and night. Keep enough plants online or the lights go out.' : 'Air-conditioners run day and night. Keep enough plants online or the lights go out.' },
          { title: cold ? '\u5bd2\u6d41\u7c60\u7f69\u5168\u5e02' : '\u71b1\u6d6a\u7c60\u7f69\u5168\u5e02', deck: '\u7528\u96fb\u9700\u6c42\u4e09\u500b\u6708 +12 %',
            text: cold ? '\u96fb\u6696\u5668\u65e5\u591c\u904b\u8f49\u3002\u8981\u8b93\u8db3\u5920\u7684\u96fb\u5ee0\u5728\u7dda\uff0c\u4e0d\u7136\u5c31\u6703\u505c\u96fb\u3002' : '\u51b7\u6c23\u65e5\u591c\u904b\u8f49\u3002\u8981\u8b93\u8db3\u5920\u7684\u96fb\u5ee0\u5728\u7dda\uff0c\u4e0d\u7136\u5c31\u6703\u505c\u96fb\u3002' });
        return;
      }
      const mw = cap.reduce((a, p) => a + p.gross * Math.max(0, penalty(p, p.tech)), 0);
      state.pending = {
        id, title: cold ? 'Cold snap!' : 'Heat wave!', text: `${cold ? 'Electric heaters' : 'Air-conditioners'} push demand up 12 % for 3 months. Capture eats steam that could make power.`,
        opts: [
          { label: 'Pause capture for 2 months', effect: `+${Math.round(mw)} MW \u00b7 ${offText(state, 2)}`, zh: { label: '\u66ab\u505c\u6355\u6349 2 \u500b\u6708', effect: `+${Math.round(mw)} MW \u00b7 ${offText(state, 2, true)}` } },
          { label: 'Keep capturing', effect: 'Risk blackouts', zh: { label: '\u7e7c\u7e8c\u6355\u6349', effect: '\u53ef\u80fd\u505c\u96fb' } },
        ],
        zh: { title: cold ? '\u5bd2\u6d41\u4f86\u8972\uff01' : '\u71b1\u6d6a\u4f86\u8972\uff01', text: `${cold ? '\u96fb\u6696\u5668' : '\u51b7\u6c23'}\u8b93\u7528\u96fb\u9700\u6c42\u4e09\u500b\u6708 +12 %\u3002\u6355\u6349\u8a2d\u5099\u6703\u5403\u6389\u672c\u4f86\u53ef\u4ee5\u767c\u96fb\u7684\u84b8\u6c7d\u3002` },
      };
    } else if (id === 'storage') {
      const cost = Math.round((state.last ? state.last.captured : 0) * SHIP.perTonne * SHIP.months / 1e6);
      state.pending = {
        id, title: 'Protest at the CO\u2082 storage site', text: 'Residents near the injection wells demand that the storage site close for a safety review.',
        opts: [
          { label: 'Ignore them', effect: 'Public anger +12', zh: { label: '\u4e0d\u7406\u6703', effect: '\u6c11\u6028 +12' } },
          { label: 'Accept the review', effect: `Ship CO\u2082 to a backup site for ${SHIP.months} months, \u2248 $${cost}M \u00b7 no extra emissions`,
            zh: { label: '\u63a5\u53d7\u5be9\u67e5', effect: `${SHIP.months} \u500b\u6708\u6539\u7528\u8239\u904b\u5230\u5099\u7528\u5c01\u5b58\u5834\uff0c\u7d04 $${cost}M \u00b7 \u4e0d\u589e\u52a0\u6392\u653e` } },
        ],
        zh: { title: 'CO\u2082 \u5c01\u5b58\u5834\u5916\u7684\u6297\u8b70', text: '\u6ce8\u5165\u4e95\u9644\u8fd1\u7684\u5c45\u6c11\u8981\u6c42\u5c01\u5b58\u5834\u505c\u5de5\u63a5\u53d7\u5b89\u5168\u5be9\u67e5\u3002' },
      };
    } else if (id === 'nox') {
      const n = untreated.length;
      state.pending = {
        id, title: 'Protest over NOx and amine emissions', text: 'Residents downwind blame the plants for NOx and for traces of amines and nitrosamines from the capture units. NOx in the flue gas also helps turn amines into nitrosamines.',
        opts: [
          { label: 'Add SCR + acid wash', effect: `$${25 * n}M for ${n} plant${n > 1 ? 's' : ''}`, zh: { label: '\u52a0\u88dd SCR \u812b\u785d + \u9178\u6d17\u6bb5', effect: `${n} \u5ea7\u5ee0\u5171 $${25 * n}M` } },
          { label: 'Dismiss the protest', effect: 'Public anger +8', zh: { label: '\u4e0d\u4e88\u7406\u6703', effect: '\u6c11\u6028 +8' } },
        ],
        zh: { title: '\u5c45\u6c11\u6297\u8b70 NOx \u8207\u80fa\u6392\u653e', text: '\u4e0b\u98a8\u8655\u5c45\u6c11\u6307\u63a7\u96fb\u5ee0\u6392\u653e NOx\uff0c\u6355\u6349\u8a2d\u5099\u9084\u5e36\u51fa\u5fae\u91cf\u7684\u80fa\u8207\u4e9e\u785d\u80fa\u3002\u7159\u6c23\u4e2d\u7684 NOx \u4e5f\u6703\u8b93\u80fa\u66f4\u5bb9\u6613\u8b8a\u6210\u4e9e\u785d\u80fa\u3002' },
      };
    } else {
      const p = up[Math.floor(R() * up.length)];
      state.pending = {
        id, plant: p.id, title: `Typhoon hits ${p.name}`, text: `High winds damaged ${p.name}. It produces nothing until it is repaired (\u2212${p.gross} MW).`,
        opts: [
          { label: 'Emergency repair', effect: '$60M \u00b7 back in 1 month', zh: { label: '\u7dca\u6025\u6436\u4fee', effect: '$60M \u00b7 1 \u500b\u6708\u6062\u5fa9' } },
          { label: 'Standard repair', effect: 'Free \u00b7 offline 4 months', zh: { label: '\u4e00\u822c\u7dad\u4fee', effect: '\u514d\u8cbb \u00b7 \u505c\u6a5f 4 \u500b\u6708' } },
        ],
        zh: { title: `\u98b1\u98a8\u91cd\u5275${pZh(p)}`, text: `\u5f37\u98a8\u640d\u58de\u4e86${pZh(p)}\uff0c\u4fee\u597d\u4e4b\u524d\u5b8c\u5168\u4e0d\u80fd\u767c\u96fb(\u2212${p.gross} MW)\u3002` },
      };
    }
  }
  function choose(state, i) {
    const ev = state.pending;
    if (!ev) return;
    state.pending = null;
    if (ev.id === 'heat') {
      if (i === 0) { state.captureOff = 2; state.captureOffWhy = 'heat-wave pause'; addNews(state, 'event', 'Capture paused for 2 months to keep the lights on.', '\u70ba\u4e86\u4e0d\u505c\u96fb\uff0c\u6355\u6349\u66ab\u505c 2 \u500b\u6708\u3002'); }
      else addNews(state, 'event', 'Capture stays on. Hope the grid holds.', '\u6355\u6349\u7e7c\u7e8c\u904b\u8f49\uff0c\u5e0c\u671b\u96fb\u7db2\u6490\u5f97\u4f4f\u3002');
    } else if (ev.id === 'storage') {
      if (i === 0) { angry(state, 12); addNews(state, 'event', 'You ignored the storage-site protest. Public anger +12.', '\u4f60\u4e0d\u7406\u6703\u5c01\u5b58\u5834\u6297\u8b70\uff0c\u6c11\u6028 +12\u3002'); }
      else {
        state.shipMonths = SHIP.months;
        addNews(state, 'event', `Storage site under review: captured CO\u2082 is shipped to a backup site for ${SHIP.months} months (+$${SHIP.perTonne}/t).`,
          `\u5c01\u5b58\u5834\u5be9\u67e5\u4e2d\uff1a\u6355\u6349\u7684 CO\u2082 \u6539\u7528\u8239\u904b\u5230\u5099\u7528\u5c01\u5b58\u5834 ${SHIP.months} \u500b\u6708(\u6bcf\u5678 +$${SHIP.perTonne})\u3002`);
      }
    } else if (ev.id === 'nox') {
      if (i === 0) {
        const am = capturing(state).filter(p => !p.washed);
        state.funds -= 25 * am.length; am.forEach(p => { p.washed = true; });
        addNews(state, 'build', `SCR and acid-wash sections added on ${am.length} plant${am.length > 1 ? 's' : ''} ($${25 * am.length}M).`, `${am.length} \u5ea7\u5ee0\u52a0\u88dd SCR \u8207\u9178\u6d17\u6bb5($${25 * am.length}M)\u3002`);
      } else { angry(state, 8); addNews(state, 'event', 'You dismissed the emissions protest. Public anger +8.', '\u4f60\u4e0d\u7406\u6703\u6392\u653e\u6297\u8b70\uff0c\u6c11\u6028 +8\u3002'); }
    } else if (ev.id === 'typhoon') {
      const p = findPlant(state, ev.plant);
      if (!p) return;
      if (i === 0) { state.funds -= 60; p.down = 1; p.downWhy = 'typhoon repair'; addNews(state, 'event', `${p.name}: emergency typhoon repair ($60M), back next month.`, `${pZh(p)}\uff1a\u98b1\u98a8\u7dca\u6025\u6436\u4fee($60M)\uff0c\u4e0b\u500b\u6708\u6062\u5fa9\u3002`); }
      else { p.down = 4; p.downWhy = 'typhoon repair'; addNews(state, 'event', `${p.name}: standard typhoon repair, offline 4 months.`, `${pZh(p)}\uff1a\u98b1\u98a8\u4e00\u822c\u7dad\u4fee\uff0c\u505c\u6a5f 4 \u500b\u6708\u3002`); }
    }
  }
  function forcedEvent(state, R) {
    const hasGas = state.plants.some(p => isGas(p.type) && online(p));
    const pool = ['subsidy'];
    const rg = RG(state);
    const mo = state.m % 12;
    if (hasGas) { pool.push('gas'); if (rg.lng) pool.push('lng', 'lng'); if (rg.winter && (mo === 11 || mo <= 1)) pool.push('winter', 'winter', 'winter'); }
    if (state.rate > 6) pool.push('health');
    if (!state.usCut && state.m >= 18) pool.push('uscut');
    const k = pool[Math.floor(R() * pool.length)];
    if (k === 'gas') {
      state.gasMult = 1.8; state.gasMonths = 6;
      headline(state, 'gas', 'bad',
        { title: 'Gas prices soar', deck: 'Gas fuel costs 80 % more for six months', text: 'A cold spell abroad and a pipeline outage send gas prices to a record. Every gas plant in Capture City pays 80 % more for its fuel until the market calms down.' },
        { title: '\u5929\u7136\u6c23\u50f9\u683c\u98c6\u6f32', deck: '\u516d\u500b\u6708\u5167\u71c3\u6c23\u71c3\u6599\u8cb4 80 %', text: '\u570b\u5916\u5bd2\u6d41\u52a0\u4e0a\u7ba1\u7dda\u505c\u64fa\uff0c\u5929\u7136\u6c23\u50f9\u683c\u5275\u65b0\u9ad8\u3002\u6355\u6349\u57ce\u6bcf\u5ea7\u71c3\u6c23\u5ee0\u7684\u71c3\u6599\u90fd\u8981\u591a\u4ed8 80 %\uff0c\u76f4\u5230\u5e02\u5834\u5e73\u975c\u4e0b\u4f86\u3002' });
    } else if (k === 'lng') {
      state.lngCut = 2;
      headline(state, 'lng', 'bad',
        { title: 'LNG tanker stuck at sea', deck: 'Gas plants at half power for two months', text: 'The island keeps only days of liquefied gas in its tanks. With the next tanker delayed by a storm, gas plants must run at half power until supply is back.' },
        { title: 'LNG \u8239\u53d7\u56f0\u6d77\u4e0a', deck: '\u71c3\u6c23\u5ee0\u5169\u500b\u6708\u53ea\u80fd\u534a\u8f09\u904b\u8f49', text: '\u5cf6\u4e0a\u7684\u6db2\u5316\u5929\u7136\u6c23\u53ea\u5b58\u5f97\u4e86\u5e7e\u5929\u3002\u4e0b\u4e00\u8258\u8239\u88ab\u98a8\u66b4\u803d\u64f1\uff0c\u71c3\u6c23\u5ee0\u53ea\u80fd\u534a\u8f09\u904b\u8f49\uff0c\u76f4\u5230\u4f9b\u61c9\u6062\u5fa9\u3002' });
    } else if (k === 'winter') {
      state.gasFreeze = 1;
      headline(state, 'winter', 'bad',
        { title: 'Winter storm freezes gas wells', deck: 'Gas plants at 30 % for a month', text: 'Frozen wellheads and pipes choke the gas supply. Gas plants can only run at 30 % this month, just as heaters push demand up.' },
        { title: '\u51ac\u5b63\u66b4\u98a8\u96ea\u51cd\u4f4f\u6c23\u4e95', deck: '\u71c3\u6c23\u5ee0\u9019\u500b\u6708\u53ea\u5269 30 %', text: '\u4e95\u53e3\u548c\u7ba1\u7dda\u7d50\u51b0\uff0c\u5929\u7136\u6c23\u4f9b\u61c9\u5361\u4f4f\u3002\u71c3\u6c23\u5ee0\u9019\u500b\u6708\u53ea\u80fd\u8dd1 30 %\uff0c\u504f\u504f\u96fb\u6696\u5668\u53c8\u628a\u7528\u96fb\u63a8\u9ad8\u3002' });
    } else if (k === 'subsidy') {
      state.subsidy = 12;
      headline(state, 'subsidy', 'good',
        { title: 'Government backs carbon capture', deck: 'Capture projects 30 % cheaper for a year', text: 'A new clean-air package pays part of every capture project started in the next 12 months: installing, switching and upgrading capture all cost 30 % less.' },
        { title: '\u653f\u5e9c\u529b\u633a\u78b3\u6355\u6349', deck: '\u4e00\u5e74\u5167\u6355\u6349\u5de5\u7a0b\u4fbf\u5b9c 30 %', text: '\u65b0\u7684\u7a7a\u6c61\u65b9\u6848\u6703\u88dc\u52a9\u672a\u4f86 12 \u500b\u6708\u5167\u958b\u5de5\u7684\u6355\u6349\u5de5\u7a0b\uff1a\u65b0\u88dd\u3001\u63db\u6eb6\u5291\u3001\u5347\u7d1a\u90fd\u4fbf\u5b9c 30 %\u3002' });
    } else if (k === 'health') {
      angry(state, 8);
      headline(state, 'health', 'bad',
        { title: 'Doctors link smog to asthma', deck: 'Public anger +8', text: 'A hospital study finds more childhood asthma in neighbourhoods downwind of the power plants. Parents are marching outside City Hall.' },
        { title: '\u91ab\u5e2b\uff1a\u7a7a\u6c61\u8207\u6c23\u5598\u6709\u95dc', deck: '\u6c11\u6028 +8', text: '\u91ab\u9662\u7814\u7a76\u767c\u73fe\uff0c\u96fb\u5ee0\u4e0b\u98a8\u8655\u7684\u793e\u5340\u5152\u7ae5\u6c23\u5598\u6bd4\u4f8b\u8f03\u9ad8\u3002\u5bb6\u9577\u5011\u5728\u5e02\u653f\u5e9c\u5916\u904a\u884c\u3002' });
    } else {
      state.usCut = true; state.resCut = 24; state.opexCut = 24;
      headline(state, 'subcut', 'bad',
        { title: 'President axes carbon-capture funding', deck: 'Research +50 %, capture running costs +30 % for two years', text: 'The White House has cancelled federal support for carbon capture overnight. Partner labs lose their grants, so every lab project costs 50 % more, and solvent and service suppliers pass on their losses: running a capture plant costs 30 % more. Both last two years.' },
        { title: '\u7e3d\u7d71\u780d\u6389\u78b3\u6355\u6349\u88dc\u52a9', deck: '\u5169\u5e74\u5167\u7814\u767c\u8cbb +50 %\u3001\u6355\u6349\u904b\u8f49\u8cbb +30 %', text: '\u767d\u5bae\u4e00\u591c\u4e4b\u9593\u53d6\u6d88\u806f\u90a6\u7684\u78b3\u6355\u6349\u88dc\u52a9\u3002\u5408\u4f5c\u5be6\u9a57\u5ba4\u5931\u53bb\u7d93\u8cbb\uff0c\u6bcf\u500b\u7814\u767c\u5c08\u6848\u90fd\u8cb4 50 %\uff1b\u6eb6\u5291\u8207\u7dad\u4fee\u5ee0\u5546\u628a\u640d\u5931\u8f49\u5ac1\u51fa\u4f86\uff0c\u6355\u6349\u5ee0\u904b\u8f49\u8cbb\u8cb4 30 %\u3002\u5169\u8005\u90fd\u6301\u7e8c\u5169\u5e74\u3002' });
    }
  }
  // a front-page story: the page shows it as a newspaper and the game waits until it is read
  function headline(state, id, tone, en, zh) {
    state.headlineN = (state.headlineN || 0) + 1;
    state.headline = { n: state.headlineN, id, tone, title: en.title, deck: en.deck, text: en.text, zh };
    addNews(state, tone === 'good' ? 'good' : id === 'subcut' ? 'policy' : 'event', `${en.title}: ${en.deck}.`, `${zh.title}\uff1a${zh.deck}\u3002`);
  }

  // ---- one month --------------------------------------------------------------
  function step(state) {
    if (state.over || state.pending) return state;
    const R = rng(state.seed + state.m * 7919);
    const y = year(state);
    const evAnger = state.angerEvt || 0;   // anger from decisions and news since last month
    state.angerEvt = 0;
    if (!state.built) state.built = {};

    // scheduled news
    const rgn = RG(state);
    if (state.m % 12 === 0) {
      const t = carbonTax(y, state), next = carbonTax(y + 1, state);
      if (state.m === 0) {
        if (rgn.credit) addNews(state, 'policy', `No carbon tax here. The 45Q credit pays $${rgn.credit} per tonne stored, for ${rgn.creditMonths / 12} years per plant.`, `\u9019\u88e1\u6c92\u6709\u78b3\u7a05\u300245Q \u62b5\u6e1b\u6bcf\u5c01\u5b58\u4e00\u5678\u4ed8 $${rgn.credit}\uff0c\u6bcf\u5ea7\u5ee0\u7d66 ${rgn.creditMonths / 12} \u5e74\u3002`);
        else addNews(state, 'policy', `${y}: carbon price $${t}/t. Storing CO\u2082 costs $${rgn.ts}/t for transport and storage.`, `${y} \u5e74\uff1a\u78b3\u50f9\u6bcf\u5678 $${t}\u3002CO\u2082 \u904b\u8f38\u8207\u5c01\u5b58\u6bcf\u5678 $${rgn.ts}\u3002`);
      } else {
        addNews(state, 'policy', `${y}: carbon price $${t}/t, CO\u2082 limit ${f1(limitFor(state, y))} Mt/yr and falling.`, `${y} \u5e74\uff1a\u78b3\u50f9\u6bcf\u5678 $${t}\uff0cCO\u2082 \u9650\u984d\u6bcf\u5e74 ${f1(limitFor(state, y))} Mt\uff0c\u6301\u7e8c\u4e0b\u964d\u3002`);
      }
      if (next >= t * 1.5 && next - t >= 15) {
        addNews(state, 'policy', `Next year the carbon price jumps to $${next}/t.`, `\u660e\u5e74\u78b3\u50f9\u5c07\u8df3\u5230\u6bcf\u5678 $${next}\u3002`);
        flash(state, 'event', `Carbon price jumps to $${next}/t next year.`, `\u660e\u5e74\u78b3\u50f9\u8df3\u5230\u6bcf\u5678 $${next}\u3002`);
      }
      // forecast: warn once when today's emissions will pass the limit within 3 years
      for (let k = 1; k <= 3 && state.m > 0; k++) {
        if (state.rate > limitFor(state, y + k) && state.warnedYear !== y + k && state.rate <= limitFor(state, y)) {
          state.warnedYear = y + k;
          addNews(state, 'event', `Forecast: at today's emissions you pass the CO\u2082 limit in ${y + k}. Cut emissions before then.`, `\u9810\u6e2c\uff1a\u7167\u76ee\u524d\u6392\u653e\uff0c\u4f60\u6703\u5728 ${y + k} \u5e74\u8d85\u904e CO\u2082 \u9650\u984d\u3002\u4e4b\u524d\u5c31\u8981\u6e1b\u6392\u3002`);
          flash(state, 'event', `Forecast: you pass the CO\u2082 limit in ${y + k} at today's emissions.`, `\u9810\u6e2c\uff1a\u7167\u76ee\u524d\u6392\u653e\uff0c${y + k} \u5e74\u6703\u8d85\u904e\u9650\u984d\u3002`);
          break;
        }
      }
    }

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
          addNews(state, 'lab', `Breakthrough! ${pr.name} is ready to install.`, `\u7a81\u7834\uff01${pr.zh.name}\u53ef\u4ee5\u5b89\u88dd\u4e86\u3002`);
          flash(state, 'lab', `Research done: ${pr.name}.`, `\u7814\u767c\u5b8c\u6210\uff1a${pr.zh.name}\u3002`);
        } else if (R() < odds && undiscovered(state).length) {
          const found = drawSolvent(state, R);
          state.unlocked[found] = true;
          state.foundBy = state.foundBy || {}; state.foundBy[found] = mt;
          state.tries.screen = 0;
          state.discovery = { n: (state.discovery ? state.discovery.n : 0) + 1, id: found, method: mt };
          addNews(state, 'lab', `Discovery! ${mt === 'comp' ? 'Computer screening' : 'Lab experiments'} found ${TECHS[found].name} (${'\u2605'.repeat(DROPS[found].stars)}).`,
            `\u767c\u73fe\uff01${mt === 'comp' ? '\u96fb\u8166\u7be9\u9078' : '\u5be6\u9a57'}\u627e\u5230\u4e86${tZh(found)}(${'\u2605'.repeat(DROPS[found].stars)})\u3002`);
        } else {
          state.tries.screen = (state.tries.screen || 0) + 1;
          const comp = mt === 'comp';
          addNews(state, 'event', comp
            ? `Screening came up empty: the predicted candidates failed in the lab. The next screen learns from it (+${Math.round(METHODS.comp.learn * 100)} % odds).`
            : 'Screening came up empty: the experiments hit a dead end.',
            comp ? `\u7be9\u9078\u843d\u7a7a\uff1a\u9810\u6e2c\u7684\u5019\u9078\u7269\u5728\u5be6\u9a57\u5ba4\u5931\u6557\u4e86\u3002\u4e0b\u4e00\u6b21\u6703\u5f9e\u4e2d\u5b78\u7fd2(\u6a5f\u7387 +${Math.round(METHODS.comp.learn * 100)} %)\u3002` : '\u7be9\u9078\u843d\u7a7a\uff1a\u5be6\u9a57\u8d70\u9032\u6b7b\u80e1\u540c\u3002');
          flash(state, 'event', 'Screening came up empty. Try again.', '\u7be9\u9078\u843d\u7a7a\uff0c\u518d\u8a66\u4e00\u6b21\u3002');
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
        addNews(state, 'build', `${p.name} is online (+${p.gross} MW).`, `${pZh(p)}\u4e0a\u7dda(+${p.gross} MW)\u3002`);
      } else if (b.kind === 'convert') {
        p.type = b.toType; p.gross = PLANT_TYPES[b.toType].size;
        p.name = pName(p);
        addNews(state, 'build', `${p.name}: conversion finished (${p.gross} MW).`, `${pZh(p)}\uff1a\u6539\u5efa\u5b8c\u6210(${p.gross} MW)\u3002`);
      } else if (b.kind === 'ic' || b.kind === 'sf') {
        p[b.kind] = true;
        addNews(state, 'build', `${p.name}: ${jobName(b)} is running.`, `${pZh(p)}\uff1a${jobZh(b)}\u555f\u7528\u3002`);
      } else {
        if (p.tech !== b.tech) { p.washed = !!TECHS[b.tech].noEmit; p.stackAge = 0; }
        p.tech = b.tech; p.deep = !!b.deep;
        state.techUsed[p.tech] = true;
        addNews(state, 'build', `${p.name}: ${TECHS[p.tech].short}${p.deep ? ' at 99 %' : ''} capture is online.`, `${pZh(p)}\uff1a${TECHS[p.tech].short}${p.deep ? ' 99 %' : ''} \u6355\u6349\u4e0a\u7dda\u3002`);
      }
    }
    // the next queued job starts as soon as a plant (or the lab) is free
    startQueues(state);
    // start-up failures, precipitation / rotor faults, fuel-cell stack replacement
    for (const p of state.plants) {
      if (p.outage > 0) { p.outage -= 1; continue; }
      if (!p.tech || !online(p)) continue;
      const t = TECHS[p.tech];
      const tz = t.zh || {};
      const mat = maturity(state, p.tech);
      if (t.stack && ++p.stackAge >= t.stack) {
        p.stackAge = 0; p.outage = 2;
        const c = Math.round(0.15 * capexFull(p, p.tech));
        state.funds -= c;
        addNews(state, 'build', `${p.name}: fuel-cell stacks worn out after ${t.stack / 12} years, replaced ($${c}M, capture off 2 months).`, `${pZh(p)}\uff1a\u71c3\u6599\u96fb\u6c60\u5806\u7528\u4e86 ${t.stack / 12} \u5e74\u5df2\u8001\u5316\uff0c\u66f4\u63db($${c}M\uff0c\u6355\u6349\u505c 2 \u500b\u6708)\u3002`);
        flash(state, 'event', `${p.name}: fuel-cell stacks replaced ($${c}M).`, `${pZh(p)}\uff1a\u66f4\u63db\u71c3\u6599\u96fb\u6c60\u5806($${c}M)\u3002`);
      } else if (mat.risk > 0 && R() < mat.risk) {
        p.outage = 3; p.outageWhy = 'start-up failure'; p.down = 1; p.downWhy = 'tripped';
        state.funds -= 15; state.fails += 1;
        addNews(state, 'event', `${p.name}: ${t.short} start-up failure, ${t.fail}. Plant tripped for a month, capture off 3 months, repair $15M (${mat.exp}/${PROVEN_MONTHS} months of experience).`,
          `${pZh(p)}\uff1a${t.short} \u958b\u6a5f\u6545\u969c\uff0c${tz.fail || t.fail}\u3002\u96fb\u5ee0\u8df3\u6a5f 1 \u500b\u6708\u3001\u6355\u6349\u505c 3 \u500b\u6708\u3001\u7dad\u4fee $15M(\u7d2f\u7a4d\u7d93\u9a57 ${mat.exp}/${PROVEN_MONTHS} \u500b\u6708)\u3002`);
        flash(state, 'event', `${p.name}: ${t.short} start-up failure, ${t.fail}.`, `${pZh(p)}\uff1a${t.short} \u958b\u6a5f\u6545\u969c\uff0c${tz.fail || t.fail}\u3002`);
      } else if (t.risk && R() < t.risk) {
        p.outage = t.rate >= 10 ? 1 : 2; p.outageWhy = 'fault';
        addNews(state, 'event', `${p.name}: ${t.riskText}, capture off for ${p.outage} month${p.outage > 1 ? 's' : ''}.`, `${pZh(p)}\uff1a${tz.riskText || t.riskText}\uff0c\u6355\u6349\u505c ${p.outage} \u500b\u6708\u3002`);
        flash(state, 'event', `${p.name}: ${t.riskText}.`, `${pZh(p)}\uff1a${tz.riskText || t.riskText}\u3002`);
      }
    }

    // dispatch: cheapest net MWh first
    const tax = carbonTax(y, state);
    const ts = rgn.ts || 0;
    const units = state.plants.filter(online).map(p => {
      const pt = PLANT_TYPES[p.type];
      const on = p.tech && p.outage <= 0 && state.captureOff <= 0;
      const e = on ? eff(p.tech, p.deep, p.type, p.ic, p.sf) : null;
      if (e && state.opexCut > 0) e.opex *= 1.3;   // subsidy cut: suppliers pass on their losses
      const c = e ? e.capture * (flexNow(state) ? FLEX : 1) : 0;
      const pen = e ? pt.intensity * c * workPerTonne(e) - e.power : 0;
      const fuel = fuelOf(state, p.type) * (1 + (e ? e.power : 0));   // a fuel cell burns extra gas for its extra power
      const avail = pt.gas ? (state.gasFreeze > 0 ? 0.3 : state.lngCut > 0 ? 0.5 : 1) : 1;
      const credit = rgn.credit && (p.capMonths || 0) < rgn.creditMonths ? rgn.credit : 0;
      const perGross = fuel + (e ? (e.opex + ts - credit) * pt.intensity * c : 0) + tax * pt.intensity * (1 - c);
      return { p, pt, e, c, pen, credit, netCap: p.gross * avail * (1 - pen), marginal: perGross / (1 - pen), fuel };
    }).sort((a, b) => a.marginal - b.marginal);

    const D = demand(state);
    let left = D, revenue = 0, cost = 0, emitted = 0, captured = 0, served = 0, netCapTotal = 0;
    let surplus = D * SURPLUS_SHARE, soldMW = 0, taxPaid = 0, creditPaid = 0, tsPaid = 0;
    const burn = (u, mw, price) => {
      const netMWh = mw * HOURS;
      const grossMWh = netMWh / (1 - u.pen);
      const co2 = grossMWh * u.pt.intensity;
      const cap = co2 * u.c, emi = co2 - cap;
      emitted += emi; captured += cap;
      cost += grossMWh * u.fuel + (u.e ? cap * (u.e.opex + ts) : 0) + emi * tax;
      taxPaid += emi * tax; tsPaid += cap * ts; creditPaid += cap * u.credit;
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
    const surplusCap = surplus;
    for (const u of units) {
      const spare = Math.min(u.netCap - u.run, surplus);
      const wp = rgn.wholesale * (1 - 0.3 * (soldMW + spare / 2) / surplusCap);   // selling more pushes the market price down
      if (spare <= 0 || u.marginal >= wp) continue;
      burn(u, spare, wp);
      surplus -= spare; soldMW += spare; u.run += spare;
    }
    let importMW = 0;
    if (rgn.imports && left > 0) { importMW = Math.min(left, rgn.imports); left -= importMW; served += importMW * HOURS; revenue += importMW * HOURS * state.price; cost += importMW * HOURS * 150; }
    for (const p of state.plants) cost += p.gross * PLANT_TYPES[p.type].fixed * 1e6;
    cost -= creditPaid;
    if (state.shipMonths > 0) cost += captured * SHIP.perTonne;
    for (const u of units) if (u.c > 0 && u.run > 0) {
      const p = u.p;
      p.capMonths = (p.capMonths || 0) + 1;
      if (rgn.credit && p.capMonths === rgn.creditMonths) addNews(state, 'policy', `${p.name}: its 45Q credit has run out after ${rgn.creditMonths / 12} years.`, `${pZh(p)}\uff1a45Q \u62b5\u6e1b ${rgn.creditMonths / 12} \u5e74\u671f\u6eff\u3002`);
    }
    state.sold = soldMW; state.soldTotal += soldMW * HOURS / 1000; state.imported = importMW;
    state.creditPaid += creditPaid / 1e6; state.taxPaid += taxPaid / 1e6; state.tsPaid = (state.tsPaid || 0) + tsPaid / 1e6;
    const overhead = 25e6;
    const profit = (revenue - cost - overhead) / 1e6;
    state.funds += profit;

    // technology experience (a new technology is proven after 24 months in operation)
    const seen = {};
    for (const p of state.plants) if (p.tech && online(p)) seen[p.tech] = true;
    for (const id of Object.keys(seen)) {
      state.exp[id] = (state.exp[id] || 0) + 1;
      if (TECHS[id].startup && state.exp[id] === PROVEN_MONTHS) {
        addNews(state, 'good', `${TECHS[id].name} is now proven: no more start-up failures.`, `${tZh(id)}\u5df2\u7d93\u6210\u719f\uff1a\u4e0d\u6703\u518d\u6709\u958b\u6a5f\u6545\u969c\u3002`);
        flash(state, 'good', `${TECHS[id].short} is proven after 2 years: no more start-up failures.`, `${TECHS[id].short} \u904b\u8f49 2 \u5e74\u5df2\u6210\u719f\uff1a\u4e0d\u518d\u6709\u958b\u6a5f\u6545\u969c\u3002`);
      }
    }

    // CO2 accounting against the shrinking limit
    const unservedFrac = Math.max(0, left) / D;
    const monthMt = emitted / 1e6;
    state.cumCO2 += monthMt;
    state.captured += captured / 1e6;
    state.recent.push(monthMt);
    if (state.recent.length > 3) state.recent.shift();
    state.rate = state.recent.reduce((a, b) => a + b, 0) / state.recent.length * 12;
    const lim = limit(state);
    const allow = lim / 12;
    state.greenhouse = Math.max(0, Math.min(100, state.greenhouse + breachStep(monthMt / allow)));
    if (monthMt > allow) {
      state.overMonths += 1;
      if (!state.wasOver) {
        state.wasOver = true;
        addNews(state, 'event', `Over the CO\u2082 limit (${f1(lim)} Mt/yr)! The breach meter is rising.`, `\u8d85\u904e CO\u2082 \u9650\u984d(\u6bcf\u5e74 ${f1(lim)} Mt)\uff01\u8d85\u6a19\u8a08\u91cf\u4e0a\u5347\u4e2d\u3002`);
        flash(state, 'event', 'Over the CO\u2082 limit! The breach meter is rising (100 % = game over).', '\u8d85\u904e CO\u2082 \u9650\u984d\uff01\u8d85\u6a19\u8a08\u91cf\u4e0a\u5347\u4e2d(100 % \u5c31\u7d50\u675f)\u3002');
      }
    } else {
      state.wasOver = false;
    }
    state.maxDebt = Math.max(state.maxDebt, state.greenhouse);

    // public anger, kept per source so the page can show where it comes from
    const baseRate = rgn.base * HOURS * 0.95;
    const smog = emitted / baseRate;
    const FAIR = rgn.fair;
    const parts = {
      price: 7 * Math.max(0, (state.price - FAIR) / FAIR) - (state.price < FAIR ? 0.8 * (FAIR - state.price) / FAIR : 0),
      blackout: 40 * unservedFrac,
      smog: 1.2 * smog,
      breach: 0.02 * state.greenhouse,
      calm: -1.0,
      events: evAnger,
    };
    const dA = parts.price + parts.blackout + parts.smog + parts.breach + parts.calm;
    state.angerParts = parts;
    state.anger = Math.max(0, Math.min(100, state.anger + dA));
    if (unservedFrac > 0.02) { state.blackouts += 1; addNews(state, 'event', `Blackouts: ${Math.round(unservedFrac * 100)} % of demand unserved!`, `\u505c\u96fb\uff1a${Math.round(unservedFrac * 100)} % \u7684\u7528\u96fb\u6c92\u6709\u4f9b\u61c9\uff01`); }

    // timers
    if (state.demandMonths > 0 && --state.demandMonths === 0) state.demandMult = 1;
    if (state.gasMonths > 0 && --state.gasMonths === 0) state.gasMult = 1;
    if (state.subsidy > 0) state.subsidy -= 1;
    if (state.resCut > 0) state.resCut -= 1;
    if (state.opexCut > 0 && --state.opexCut === 0) addNews(state, 'good', 'Capture running costs are back to normal.', '\u6355\u6349\u904b\u8f49\u8cbb\u6062\u5fa9\u6b63\u5e38\u3002');
    if (state.lngCut > 0 && --state.lngCut === 0) addNews(state, 'good', 'LNG supply is back to normal.', 'LNG \u4f9b\u61c9\u6062\u5fa9\u6b63\u5e38\u3002');
    if (state.gasFreeze > 0) state.gasFreeze -= 1;
    if (state.shipMonths > 0 && --state.shipMonths === 0) addNews(state, 'good', 'The storage site is open again.', '\u5c01\u5b58\u5834\u91cd\u65b0\u958b\u653e\u3002');
    if (state.captureOff > 0 && --state.captureOff === 0) addNews(state, 'good', 'Capture is back on.', '\u6355\u6349\u6062\u5fa9\u904b\u8f49\u3002');
    for (const p of state.plants) if (p.down > 0 && --p.down === 0) addNews(state, 'good', `${p.name} is running again.`, `${pZh(p)}\u6062\u5fa9\u904b\u8f49\u3002`);

    state.last = {
      demand: D, netCap: netCapTotal, served: served / HOURS, unservedFrac, emitted, captured, limit: lim,
      revenue: revenue / 1e6, cost: cost / 1e6 + overhead / 1e6, profit, tax, credit: rgn.credit, gasFuel: gasFuel(state), sold: soldMW, imported: importMW,
      units: units.map(u => ({ id: u.p.id, run: u.run, netCap: u.netCap, pen: u.pen, c: u.c })),
    };

    state.m += 1;
    if (state.greenhouse >= 100) state.over = { win: false, why: 'greenhouse' };
    else if (state.anger >= 100) state.over = { win: false, why: 'anger' };
    else if (state.funds < BANKRUPT) state.over = { win: false, why: 'bankrupt' };
    else if (state.m >= MONTHS) state.over = { win: true, why: 'survived' };

    // random events for next month (a choice pauses the game until answered); at least a year apart
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
  function score(s) {
    return Math.round(Math.max(0, 250 - s.cumCO2) * 6 + (100 - s.anger) * 5 + Math.min(3000, Math.max(0, s.funds)) * 0.5 + s.captured * 1.5);
  }
  function stars(s) {
    if (!s.over || !s.over.win) return 0;
    const sc = score(s);
    const [two, three] = RG(s).stars;
    return sc >= three ? 3 : sc >= two ? 2 : 1;
  }

  const api = {
    HOURS, MONTHS, START_YEAR, END_YEAR, FAIR_PRICE, BANKRUPT, MAX_PLANTS, DEMOLISH_COST, LIMIT_POINTS, LIMIT_SCALE, START_FUNDS, CAPEX_SCALE, FOAK,
    BREACH, breachStep, REGIONS, SEASON, SURPLUS_SHARE, SHIP, METHODS, DROPS, PROVEN_MONTHS, DEEP, PLANT_TYPES, CONVERT, TECHS, TECH_ORDER, PROJECTS, LAB_ORDER, CFG,
    newGame, step, choose, offCost, online, isGas, fuelOf, foak, pZh, tZh,
    install, canInstall, installCost, installMonths, upgrade, canUpgrade, upgradeCost, convertOptions,
    QUEUE_MAX, planned, canQueue, enqueue, cancelJob, canQueueResearch, enqueueResearch, cancelResearch,
    convert, canConvert, buildPlant, canBuildPlant, demolish, canDemolish,
    startResearch, canResearch, researchCost, researchMonths, researchOdds, project, maturity,
    PROCESS, flexNow, isPeak, setFlex,
    setPrice, penalty, eff, workPerTonne, carbonTax, taxFor, limit, limitAt, limitFor, fairPrice, gasFuel, demand, peakDemand, seasonOf, year, monthName, score, stars,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
