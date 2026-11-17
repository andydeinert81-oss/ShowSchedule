/* ShowSchedule — static front end backed by Supabase (auth, Postgres, realtime). */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
const sb = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth:{flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}})
  : null;
const siteUrl = () => location.origin + location.pathname;

/* ================= species & divisions ================= */
const SPECIES = {
  cattle:{label:'Cattle', sm:'Beef Showmanship', sexes:['Heifer','Bull','Steer','Cow/Calf'],
    breeds:['Angus','Red Angus','Charolais','Chianina','Hereford','Limousin','Maine-Anjou','Shorthorn','Shorthorn Plus','Simmental','Percentage Simmental','Crossbred / AOB']},
  sheep:{label:'Sheep', sm:'Sheep Showmanship', sexes:['Ewe','Wether','Ram'],
    breeds:['Hampshire','Suffolk','Southdown','Shropshire','Dorset','Oxford','Montadale','Natural Colored','Crossbred / Blackface','Whiteface']},
  goat:{label:'Goats', sm:'Goat Showmanship', sexes:['Doe','Wether','Buck'],
    breeds:['Boer','Percentage Boer','Commercial / Crossbred']},
  swine:{label:'Swine', sm:'Swine Showmanship', sexes:['Gilt','Barrow','Boar'],
    breeds:['Berkshire','Chester White','Duroc','Hampshire','Landrace','Poland China','Spot','Yorkshire','Crossbred']}
};
const SP_ORDER = ['cattle','sheep','goat','swine'];
const DIVS = [
  {key:'bbeef', label:'Breeding Beef', species:'cattle', market:false, sexes:['Heifer','Bull','Cow/Calf']},
  {key:'mbeef', label:'Market Beef', species:'cattle', market:true, sexes:['Steer','Heifer']},
  {key:'bewe', label:'Breeding Ewe', species:'sheep', market:false, sexes:['Ewe']},
  {key:'mlamb', label:'Market Lamb', species:'sheep', market:true, sexes:['Wether','Ewe'], combine:true},
  {key:'bgoat', label:'Breeding Goat', species:'goat', market:false, sexes:['Doe']},
  {key:'mgoat', label:'Market Goat', species:'goat', market:true, sexes:['Wether','Doe'], combine:true},
  {key:'bswine', label:'Breeding Swine', species:'swine', market:false, sexes:['Gilt']},
  {key:'mswine', label:'Market Swine', species:'swine', market:true, sexes:['Barrow','Gilt']}
];
const DIV = Object.fromEntries(DIVS.map(d => [d.key, d]));
const DEFAULT_RULES = {mode:'size', table:[10,9,8,7,6,5,4,3,2,1], champBonus:5, resBonus:3, champTop:true, overall:[10,5,3,2,1], minShows:2, bestN:0};
const DEFAULT_CFG = {
  name:'New show', date:'', location:'', seriesId:'', managers:[],
  divs: Object.fromEntries(DIVS.map(d => [d.key, {on: d.species==='cattle', breeds:[...SPECIES[d.species].breeds], combine:!!d.combine, byMonth: d.key==='bbeef'}])),
  sm:{cattle:true, sheep:false, goat:false, swine:false},
  divisions:[{name:'Junior',min:8,max:10},{name:'Intermediate',min:11,max:13},{name:'Senior',min:14,max:21}],
  maxPerClass:10, startBack:101, minPerHead:1.5, driveMin:5,
  drives:true, smFirst:true, smPos:{}, entriesOpen:true, ageJan1:true,
  order:null, current:null, done:[], backs:{}, results:{}, champs:{}, overall:{}
};

/* ================= state ================= */
const S = {
  db:null, user:null, uid:null, myName:'', isAdmin:false, isOwner:false, canWrite:null, noDb:false,
  shows:{}, showsLoaded:false, entries:{}, entriesLoaded:false, barn:null, barnLoaded:false, series:{}, seriesLoaded:false,
  lookup:new Map(), view:'shows', showId:null, seriesId:null,
  search:'', resFilter:'', expanded:new Set(), drafts:{}, editing:null, confirmDel:null, confirmShowDel:false,
  setDraft:{}, showSettings:false, pending:false, slow:false, barnDraft:null, barnDirty:false, enterDraft:{},
  placeClass:null, placeDraft:{}, names:{}, nameQ:new Set(), mgrHits:[], serCat:'overall', serBreed:'', serEdit:false, serDraft:null
};
try{ S.search = localStorage.getItem('ss-follow') || ''; }catch(e){}

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rid = () => Math.random().toString(36).slice(2,10);
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const clone = o => JSON.parse(JSON.stringify(o));
const plural = s => /\//.test(s) ? s + ' Pairs' : (/s$/i.test(s) ? s : s + 's');
const fmtD = s => { if(!s) return ''; const [y,m,d] = s.split('-'); return `${+m}/${+d}/${y.slice(2)}`; };
const longDate = s => s ? new Date(s+'T12:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'}) : '';
const shortDate = s => s ? new Date(s+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}) : '';
const isSteer = sex => /steer/i.test(sex||'');
const ord = n => n + (['th','st','nd','rd'][((n%100)-20)%10] || ['th','st','nd','rd'][n%100] || 'th');
const exOf = (d, sid = S.showId) => (d && d.shows && d.shows[sid] && d.shows[sid].exhibitors) || [];
const smName = sm => [sm.first, sm.last].filter(Boolean).join(' ').trim();
const smList = ex => Array.isArray(ex.showmanship) ? ex.showmanship : (ex.showmanship ? ['cattle'] : []);
const ageName = n => (n||'').replace(/\s*showmanship\s*/i,'').trim() || n;

function normShow(s){
  const c = Object.assign({}, DEFAULT_CFG, s || {});
  const divs = {};
  if(s && !s.divs && s.breeds){            // single-show cattle version
    const sx = s.sexes || [];
    for(const d of DIVS) divs[d.key] = {on:false, breeds:[...SPECIES[d.species].breeds], combine:!!d.combine};
    divs.bbeef = {on: sx.some(x => !isSteer(x)), breeds:[...s.breeds], combine:false};
    divs.mbeef = {on: sx.some(isSteer), breeds:[...s.breeds], combine:false};
    c.sm = {cattle:true};
  } else {
    for(const d of DIVS) divs[d.key] = Object.assign({}, DEFAULT_CFG.divs[d.key], (s && s.divs && s.divs[d.key]) || {}, s && s.divs && !s.divs[d.key] ? {on:false} : {});
  }
  c.divs = divs;
  c.sm = Object.assign({cattle:false, sheep:false, goat:false, swine:false}, c.sm || {});
  c.smPos = Object.assign(Object.fromEntries(SP_ORDER.map(sp => [sp, c.smFirst === false ? 'last' : 'first'])), (s && s.smPos) || {});
  return c;
}
const cfgFor = sid => normShow(S.shows[sid]);
const cfg = () => cfgFor(S.showId);
const enabledDivs = c => DIVS.filter(d => c.divs[d.key].on);
const divCandidates = (sp, sex, c) => DIVS.filter(d => d.species===sp && c.divs[d.key].on && d.sexes.includes(sex)).map(d => d.key);
function animalDiv(an, c){
  if(an.div && c.divs[an.div] && c.divs[an.div].on) return an.div;
  return divCandidates(an.species || 'cattle', an.sex, c)[0] || null;
}
function isManager(sid = S.showId){
  if(!S.uid) return false;
  if(S.isOwner) return true;
  return ((S.shows[sid] && S.shows[sid].managers) || []).includes(S.uid);
}
function ageFor(sm, c){
  if(sm.birthdate){
    const today = new Date().toISOString().slice(0,10);
    const ref = c.ageJan1 ? (c.date || today).slice(0,4) + '-01-01' : (c.date || today);
    const [ry, rm, rd] = ref.split('-').map(Number), [by, bm, bd] = sm.birthdate.split('-').map(Number);
    return ry - by - ((rm < bm || (rm === bm && rd < bd)) ? 1 : 0);
  }
  return num(sm.age);
}
const divisionFor = (age, c) => (c.divisions||[]).find(d => age >= d.min && age <= d.max);

function toast(msg, err){
  const t = $('#toast'); t.innerHTML = `<div class="toast ${err?'err':''}">${esc(msg)}</div>`;
  clearTimeout(toast._t); toast._t = setTimeout(()=>{ t.innerHTML=''; }, 2800);
}
let queue = Promise.resolve();
/* Runs writes one at a time. On failure: explain, reload from the server, and never run the caller's success step. */
function enqueue(fn){
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p.catch(e => {
    console.error(e);
    const msg = String((e && (e.message || e.error_description)) || e);
    if(e && (e.code === '42501' || /row-level security|permission denied/i.test(msg))) toast('You don’t have permission to change that.', true);
    else if(/fetch|network|Failed to/i.test(msg)) toast('Couldn’t reach the server. Check your connection and try again.', true);
    else toast('Couldn’t save: ' + msg, true);
    loadAll();
    return new Promise(() => {});
  });
}
const MERGE_KEYS = ['results','champs','overall','backs'];
function saveState(patch){
  const id = S.showId, cur = S.shows[id] || {};
  patch = Object.assign({}, patch);
  for(const k of MERGE_KEYS) if(patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) patch[k] = Object.assign({}, cur[k] || {}, patch[k]);
  const managers = patch.managers; delete patch.managers;
  S.shows[id] = Object.assign({}, cur, patch, managers ? {managers} : {});
  render();
  return enqueue(async () => {
    if(Object.keys(patch).length){ const {error} = await sb.rpc('update_show', {p_id:id, p_patch:patch}); if(error) throw error; }
    if(managers){ const {error} = await sb.from('shows').update({managers}).eq('id', id); if(error) throw error; }
  });
}

/* ================= names (show managers) ================= */
function nameOf(id){
  if(S.names[id] !== undefined) return S.names[id] || 'Someone';
  if(!S.nameQ.has(id) && sb && S.uid){
    S.nameQ.add(id);
    sb.from('profiles').select('id,display_name').eq('id', id).maybeSingle()
      .then(({data}) => { S.names[id] = (data && data.display_name) || ''; render(); });
  }
  return '…';
}

/* ================= entries → classes ================= */
function lookupFor(sid){
  const m = new Map();
  for(const [docId, d] of Object.entries(S.entries))
    for(const ex of exOf(d, sid)){
      m.set(docId+'|'+ex.id, {type:'ex', docId, ex});
      for(const an of (ex.animals||[])) m.set(docId+'|'+an.id, {type:'an', docId, ex, an});
    }
  return m;
}
function rebuildLookup(){ S.lookup = lookupFor(S.showId); }
function activeAnimals(sid = S.showId){
  const out = [];
  for(const [docId, d] of Object.entries(S.entries))
    for(const ex of exOf(d, sid))
      for(const an of (ex.animals||[]))
        if(!an.scratched && an.breed && an.sex) out.push({key:docId+'|'+an.id, docId, ex, an});
  return out;
}
function smExhibitors(sid = S.showId){
  const out = [];
  for(const [docId, d] of Object.entries(S.entries))
    for(const ex of exOf(d, sid))
      if(smList(ex).length && ex.name) out.push({key:docId+'|'+ex.id, docId, ex});
  return out;
}
function chunk(list, max){
  const n = list.length; if(!n) return [];
  const k = Math.max(1, Math.ceil(n / Math.max(1, max)));
  const base = Math.floor(n/k), rem = n % k, out = [];
  let i = 0;
  for(let c=0; c<k; c++){ const sz = base + (c<rem?1:0); out.push(list.slice(i, i+sz)); i += sz; }
  return out;
}
function rangeText(part, byWeight){
  if(byWeight){
    const w = part.map(a=>num(a.an.weight)).filter(Boolean);
    if(!w.length) return '';
    const lo = Math.min(...w), hi = Math.max(...w);
    return lo === hi ? `${lo.toLocaleString()} lb` : `${lo.toLocaleString()}–${hi.toLocaleString()} lb`;
  }
  const b = part.map(a=>a.an.birthdate).filter(Boolean).sort();
  if(!b.length) return '';
  return b[0] === b[b.length-1] ? `Born ${fmtD(b[0])}` : `Born ${fmtD(b[0])} – ${fmtD(b[b.length-1])}`;
}
function sexTitle(d, sex){ return `${d.market && !/steer|barrow|wether/i.test(sex) ? 'Market ' : ''}${plural(sex)}`; }
function buildAuto(sid = S.showId){
  const c = cfgFor(sid);
  const animals = activeAnimals(sid).map(a => Object.assign(a, {div: animalDiv(a.an, c)})).filter(a => a.div);
  const exs = smExhibitors(sid), out = [];
  for(const sp of SP_ORDER){
    const smC = [], dc = [];
    if(c.sm[sp]){
      const mine = exs.filter(e => smList(e.ex).includes(sp)), placed = new Set();
      for(const dv of (c.divisions||[])){
        const g = mine.filter(e => { const a = num(e.ex.age); return a>=dv.min && a<=dv.max; }).sort((a,b)=>num(a.ex.age)-num(b.ex.age));
        g.forEach(e => placed.add(e.key));
        const parts = chunk(g, c.maxPerClass);
        parts.forEach((p,i) => smC.push({id:`s|${sp}|${dv.name}|${i+1}`, kind:'sm', species:sp, group:`s|${sp}|${dv.name}`,
          title:`${SPECIES[sp].sm} – ${ageName(dv.name)}`, sub: parts.length>1 ? `Class ${i+1} of ${parts.length}` : '', range:`Ages ${dv.min}–${dv.max}`, members:p.map(e=>e.key)}));
      }
      const left = mine.filter(e => !placed.has(e.key));
      if(left.length) smC.push({id:`s|${sp}|unplaced|1`, kind:'sm', species:sp, group:`s|${sp}|unplaced`, title:`${SPECIES[sp].sm} – age outside divisions`, sub:'', range:'Check ages', members:left.map(e=>e.key)});
    }
    for(const d of DIVS.filter(d => d.species===sp && c.divs[d.key].on)){
      const dv = c.divs[d.key], g0 = animals.filter(a => a.div === d.key);
      const breeds = [...dv.breeds, ...[...new Set(g0.map(a=>a.an.breed).filter(b => !dv.breeds.includes(b)))].sort()];
      const sexes = dv.combine ? [null] : [...d.sexes, ...new Set(g0.map(a=>a.an.sex).filter(x => !d.sexes.includes(x)))];
      for(const sex of sexes) for(const br of breeds){
        const g = g0.filter(a => a.an.breed===br && (sex===null || a.an.sex===sex));
        if(!g.length) continue;
        g.sort(d.market ? (a,b)=>num(a.an.weight)-num(b.an.weight) : (a,b)=>(b.an.birthdate||'').localeCompare(a.an.birthdate||''));
        const group = `${d.key}|${br}|${sex||'all'}`;
        const title = sex===null ? `${br} ${d.label}s` : `${br} ${sexTitle(d, sex)}`;
        let made = 0;
        if(dv.byMonth && !d.market && /heifer/i.test(sex||'')){
          const months = [...new Set(g.map(a => (a.an.birthdate||'').slice(0,7)))];   // already youngest first
          months.sort((x,y) => (y||'0').localeCompare(x||'0'));
          for(const mo of months){
            const parts = chunk(g.filter(a => (a.an.birthdate||'').slice(0,7) === mo), c.maxPerClass);
            const ml = mo ? new Date(mo+'-15T12:00').toLocaleDateString(undefined,{month:'long', year:'numeric'}) : 'Birth date not given';
            parts.forEach((p,i) => { made++; dc.push({id:`b|${group}|m${mo||'none'}|${i+1}`, kind:'breed', div:d.key, group, title,
              sub: (mo ? `Born ${ml}` : ml) + (parts.length>1 ? ` · ${i+1} of ${parts.length}` : ''), range:'', members: p.map(a=>a.key)}); });
          }
        } else {
          const parts = chunk(g, c.maxPerClass);
          parts.forEach((p,i) => { made++; dc.push({id:`b|${group}|${i+1}`, kind:'breed', div:d.key, group, title,
            sub: parts.length>1 ? `Class ${i+1} of ${parts.length}` : '', range: rangeText(p, d.market), members: p.map(a=>a.key)}); });
        }
        if(c.drives && made > 1) dc.push({id:`d|${group}`, kind:'drive', div:d.key, group, title:`${title} Champion Drive`, sub:'Top two from each class return', range:'', members:[]});
      }
    }
    out.push(...(c.smPos[sp] === 'last' ? [...dc, ...smC] : [...smC, ...dc]));
  }
  return out;
}
const classesFor = sid => (S.shows[sid] && S.shows[sid].order) || buildAuto(sid);
const classes = () => classesFor(S.showId);
const groupOf = cls => cls.group || cls.id.split('|').slice(0,-1).join('|');
function unassigned(){
  const st = S.shows[S.showId]; if(!st || !st.order) return [];
  const inOrder = new Set(); st.order.forEach(c => c.members.forEach(k => inOrder.add(k)));
  return [...activeAnimals().filter(x => !inOrder.has(x.key)), ...smExhibitors().filter(x => !inOrder.has(x.key))].map(x=>x.key);
}

/* ================= scoring ================= */
const rulesForSeries = id => Object.assign({}, DEFAULT_RULES, (S.series[id] && S.series[id].rules) || {});
const rulesFor = sid => rulesForSeries(S.shows[sid] && S.shows[sid].seriesId);
const placePts = (place, size, R) => R.mode === 'table' ? num((R.table||[])[place-1]) : Math.max(0, size - place + 1);
function groupMeta(cls, L, c){
  const parts = groupOf(cls).split('|');
  if(DIV[parts[0]]) return {div:parts[0], breed:parts[1], sex:parts[2]};
  const first = L.get(cls.members[0]);
  return {div: first && first.an ? animalDiv(first.an, c) : null, breed:parts[1], sex:parts[2] || 'all'};
}
function scoreShow(sid){
  const s = S.shows[sid]; if(!s || !s.order) return [];
  const c = normShow(s), R = rulesFor(sid), L = lookupFor(sid), recs = new Map();
  for(const cls of s.order){
    if(cls.kind === 'drive') continue;
    const res = ((s.results||{})[cls.id] || []).filter(k => L.has(k) && cls.members.includes(k)), size = res.length;
    const meta = cls.kind === 'breed' ? groupMeta(cls, L, c) : null;
    for(const key of cls.members){
      const x = L.get(key); if(!x) continue;
      const isAn = x.type === 'an';
      const r = {key, showId:sid, kind: isAn ? 'an' : 'sm', docId:x.docId, exKey:x.docId+'|'+x.ex.id, exName:x.ex.name, town:x.ex.town||'',
        animal: isAn ? (x.an.name||'Unnamed') : '', div: isAn ? (meta && meta.div) : null, species: cls.species || 'cattle',
        breed: isAn ? x.an.breed : '', sex: isAn ? x.an.sex : '', classId:cls.id, classTitle: cls.title + (cls.sub ? ' · '+cls.sub : ''),
        group: groupOf(cls), place:null, size, placePts:0, award:'', basePts:null, bonus:0, overallPlace:null, overallPts:0, total:0};
      const i = res.indexOf(key);
      if(i >= 0){ r.place = i+1; r.placePts = placePts(i+1, size, R); }
      recs.set(key, r);
    }
  }
  for(const [group, ch] of Object.entries(s.champs||{})){
    const winners = [...recs.values()].filter(r => r.group===group && r.place===1).map(r => r.placePts);
    const top = winners.length ? Math.max(...winners) : 0;
    for(const [k, label, bonus] of [[ch && ch.ch, 'Champion', R.champBonus], [ch && ch.res, 'Reserve', R.resBonus]]){
      const r = k && recs.get(k); if(!r || r.group !== group) continue;
      r.award = label; r.basePts = R.champTop ? Math.max(top, r.placePts) : r.placePts; r.bonus = num(bonus);
    }
  }
  for(const list of Object.values(s.overall||{})) (list||[]).forEach((k, i) => { const r = recs.get(k); if(r){ r.overallPlace = i+1; r.overallPts = num((R.overall||[])[i]); } });
  for(const r of recs.values()) r.total = (r.basePts ?? r.placePts) + r.bonus + r.overallPts;
  return [...recs.values()];
}
function seriesStandings(serId){
  const R = rulesForSeries(serId);
  const shows = Object.entries(S.shows).filter(([, s]) => s.seriesId === serId).sort((a,b) => (a[1].date||'').localeCompare(b[1].date||''));
  const cats = new Map();
  const add = (cat, label, key, row, sid, pts) => {
    if(!cats.has(cat)) cats.set(cat, {label, rows:new Map()});
    const rows = cats.get(cat).rows;
    if(!rows.has(key)) rows.set(key, Object.assign({key, per:{}}, row));
    const x = rows.get(key); x.per[sid] = (x.per[sid] || 0) + pts;
    Object.assign(x, row);
  };
  for(const [sid] of shows){
    for(const r of scoreShow(sid)){
      if(r.place == null) continue;
      add('overall', 'Exhibitor overall', r.exKey, {name:r.exName, sub:r.town}, sid, r.total);
      if(r.kind === 'an' && r.div) add('div:'+r.div, DIV[r.div].label, r.key, {name:r.animal, sub:r.exName, breed:r.breed}, sid, r.total);
      if(r.kind === 'sm') add('sm:'+r.species, SPECIES[r.species].sm, r.exKey, {name:r.exName, sub:r.town}, sid, r.total);
    }
  }
  for(const cat of cats.values()) for(const x of cat.rows.values()){
    const vals = Object.values(x.per).sort((a,b) => b-a);
    x.shows = vals.length;
    x.total = (R.bestN > 0 ? vals.slice(0, R.bestN) : vals).reduce((a,b) => a+b, 0);
    x.eligible = x.shows >= (R.minShows || 0);
  }
  return {shows, cats, R};
}

/* ================= ring status ================= */
function ringInfo(){
  const c = cfg(), list = classes();
  return {c, list, ci: list.findIndex(x => x.id === c.current), done: new Set(c.done||[])};
}
function statusOf(i, info){
  const {list, ci, done} = info, cls = list[i];
  if(done.has(cls.id) && i !== ci) return {k:'done', label:'Done'};
  if(i === ci) return {k:'ring', label:'In the ring'};
  const away = i - (ci >= 0 ? ci : -1);
  if(away === 1) return {k:'deck', label: ci>=0 ? 'On deck' : 'First up'};
  if(away === 2) return {k:'hole', label: ci>=0 ? 'In the hole' : 'Second'};
  if(away < 0) return {k:'past', label:'Passed'};
  return {k:'away', label:`${away} classes away`};
}
const dur = (cls, c) => cls.kind==='drive' ? c.driveMin : Math.max(1, cls.members.length) * c.minPerHead;
function eta(i, info){
  const {list, ci, c} = info, start = ci >= 0 ? ci : 0;
  if(i <= start) return 0;
  let m = 0; for(let j=start; j<i; j++) if(!info.done.has(list[j].id) || j===ci) m += dur(list[j], c);
  return Math.round(m);
}
const fmtMin = m => m < 60 ? `~${m} min` : `~${Math.floor(m/60)} hr ${m%60 ? (m%60)+' min' : ''}`.trim();

/* ================= lineup ================= */
function backOf(key){ const b = (cfg().backs||{})[key]; return b != null ? b : '—'; }
function memberLabel(k){
  const L = S.lookup.get(k); if(!L) return {back:'—', main:'(removed)', sub:''};
  if(L.type === 'ex'){
    const backs = (L.ex.animals||[]).filter(a=>!a.scratched).map(a => backOf(L.docId+'|'+a.id)).filter(b=>b!=='—');
    return {back: backs[0] ?? '—', main: L.ex.name, sub: `age ${L.ex.age}${L.ex.town ? ' · '+L.ex.town : ''}`};
  }
  return {back: backOf(k), main: L.an.name || 'Unnamed', sub: L.ex.name + (L.ex.town ? ' · '+L.ex.town : '')};
}
function lineupHTML(cls, hlKeys){
  if(cls.kind === 'drive') return `<div class="lineup"><div class="row muted">First and second place from each class come back in for the champion drive.</div></div>`;
  if(!cls.members.length) return `<div class="lineup"><div class="row muted">No entries.</div></div>`;
  const res = ((cfg().results||{})[cls.id]) || [];
  const members = res.length ? [...res.filter(k => cls.members.includes(k)), ...cls.members.filter(k => !res.includes(k))] : cls.members;
  const rows = members.map(k => {
    const L = S.lookup.get(k); if(!L) return '';
    const hl = hlKeys && hlKeys.has(k) ? ' hl' : '', p = res.indexOf(k);
    const badge = p >= 0 ? `<span class="place p${p+1}">${ord(p+1)}</span>` : '';
    if(cls.kind === 'sm'){ const m = memberLabel(k); return `<div class="row${hl}"><span class="back">${esc(m.back)}</span><div><b>${esc(m.main)}</b> <span class="muted small">${esc(m.sub)}</span></div>${badge}</div>`; }
    const an = L.an, wt = DIV[animalDiv(an, cfg())]?.market;
    const det = wt ? (an.weight ? `${num(an.weight).toLocaleString()} lb` : '') : (an.birthdate ? `born ${fmtD(an.birthdate)}` : '');
    return `<div class="row${hl}${an.scratched?' scr':''}"><span class="back">${esc(backOf(k))}</span><div><b>${esc(an.name||'Unnamed')}</b>${an.tag?` <span class="muted small">#${esc(an.tag)}</span>`:''}<br><span class="muted small">${esc(L.ex.name)}${L.ex.town?' · '+esc(L.ex.town):''}${det?' · '+esc(det):''}${an.scratched?' · Scratched':''}</span></div>${badge}</div>`;
  }).join('');
  return `<div class="lineup">${rows}</div>`;
}
const heads = cls => cls.kind==='drive' ? 'Drive' : `${cls.members.length} ${cls.kind==='sm' ? 'exhibitor' : 'head'}${cls.members.length===1?'':'s'}`;
const subLine = cls => [cls.sub, cls.range, heads(cls)].filter(Boolean).map(esc).join(' · ');

/* ================= following ================= */
function myKeys(sid = S.showId){
  const set = new Set(); if(!S.uid) return set;
  for(const ex of exOf(S.entries[S.uid], sid)){ set.add(S.uid+'|'+ex.id); (ex.animals||[]).forEach(a => set.add(S.uid+'|'+a.id)); }
  return set;
}
function findMatches(q){
  q = q.trim().toLowerCase(); if(!q) return [];
  const c = cfg(), out = [];
  for(const [docId, d] of Object.entries(S.entries)) for(const ex of exOf(d)){
    const anKeys = (ex.animals||[]).map(a => docId+'|'+a.id);
    const hit = (ex.name||'').toLowerCase().includes(q)
      || (ex.animals||[]).some(a => (a.name||'').toLowerCase().includes(q) || (a.tag||'').toLowerCase()===q)
      || anKeys.some(k => String((c.backs||{})[k]) === q);
    if(hit) out.push({ex, keys:new Set([docId+'|'+ex.id, ...anKeys])});
  }
  return out.slice(0, 12);
}
function followListHTML(keys, info){
  const rows = [];
  info.list.forEach((cls, i) => {
    if(!cls.members.some(k => keys.has(k))) return;
    const st = statusOf(i, info), m = eta(i, info);
    const res = (info.c.results||{})[cls.id] || [];
    const placed = cls.members.filter(k => keys.has(k)).map(k => res.indexOf(k)).filter(p => p >= 0);
    const right = placed.length ? placed.map(p => `<span class="place p${p+1}">${ord(p+1)}</span>`).join(' ')
      : st.k==='done' ? 'Done' : st.k==='ring' ? '<b style="color:var(--green)">In the ring now</b>' : `${esc(st.label)}${m ? ' · '+fmtMin(m) : ''}`;
    rows.push(`<li><span>${esc(cls.title)}${cls.sub?` <span class="muted small">${esc(cls.sub)}</span>`:''}</span><span class="small">${right}</span></li>`);
  });
  return rows.length ? `<ul>${rows.join('')}</ul>` : `<div class="muted small">Not in any class yet.</div>`;
}
function findResultsHTML(){
  const info = ringInfo(), q = S.search.trim();
  if(!q) return `<div class="muted small" style="margin-top:8px">Type an exhibitor’s name, animal name, or back number to see when they show.</div>`;
  const res = findMatches(q);
  if(!res.length) return `<div class="muted small" style="margin-top:8px">No exhibitor matches “${esc(q)}”.</div>`;
  return res.map(r => `<div class="fx"><div class="who">${esc(r.ex.name)} <span class="muted small">${esc(r.ex.town||'')}</span></div>${followListHTML(r.keys, info)}</div>`).join('');
}

/* ================= gates ================= */
const loading = () => `<div class="empty muted">${S.slow ? 'Still trying to reach the show data. Check your connection.' : 'Loading…'}</div>`;
const signInMsg = what => `<div class="card empty"><h3>Log in to ${what}</h3><p class="muted">Use your ShowSchedule account. New here? Creating one takes a minute.</p><a class="btn pri" href="#account" style="text-decoration:none">Log in or create account</a></div>`;
const viewOnlyMsg = () => signInMsg('continue');
const notFound = () => `<div class="card empty"><h3>Not found</h3><p class="muted">It may have been removed.</p><a class="btn" href="#shows" style="text-decoration:none">All shows</a></div>`;
const canSave = () => !!(sb && S.uid);
function showStatus(s){
  const list = s.order || [], ci = list.findIndex(x => x.id === s.current);
  if(ci >= 0) return {k:'ring', label:`Live · ${list[ci].title}`};
  if(list.length && list.every(x => (s.done||[]).includes(x.id))) return {k:'done', label:'Complete'};
  return s.entriesOpen ? {k:'deck', label:'Entries open'} : {k:'away', label:'Entries closed'};
}
const speciesLine = c => enabledDivs(c).map(d => d.label).join(', ') || 'No divisions yet';

/* ================= view: shows ================= */
function viewShows(){
  if(S.noDb) return signInMsg('see shows');
  if(!S.showsLoaded) return loading();
  let h = `<div class="who-bar"><h2 style="margin:0">Shows</h2>${S.isAdmin ? `<button class="btn pri" data-act="newShow">+ New show</button>` : ''}</div>`;
  if(canSave() && S.barnLoaded && !(S.barn && (S.barn.showmen||[]).length))
    h += `<div class="banner info"><b>Start with your barn.</b> Add your showmen and animals once in <a href="#barn">My barn</a>. Then entering any show is just checking boxes.</div>`;
  if(!Object.keys(S.shows).length) return h + `<div class="card empty"><h3>No shows yet</h3><p class="muted">${S.isAdmin ? 'Create your first show to open entries.' : 'Check back when a show manager posts a show.'}</p></div>`;
  const series = Object.entries(S.series);
  h += `<div class="card find" style="padding:12px">
    <input id="showSearch" type="search" placeholder="Search shows by name, town, species, series or month" value="${esc(S.showQ||'')}" autocomplete="off">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
      <div class="seg" style="margin:0">${[['upcoming','Upcoming'],['past','Past'],['all','All']].map(([k,l]) => `<button class="${(S.showWhen||'upcoming')===k?'on':''}" data-act="showWhen" data-k="${k}">${l}</button>`).join('')}</div>
      ${series.length ? `<select class="in" id="showSeries" style="width:auto"><option value="">All series</option>${series.map(([id, r]) => `<option value="${esc(id)}"${S.showSer===id?' selected':''}>${esc(r.name)} ${esc(r.year||'')}</option>`).join('')}</select>` : ''}
      ${S.uid ? `<label class="check small"><input type="checkbox" id="showMine"${S.showMine?' checked':''}> Only shows I’m entered in</label>` : ''}
    </div></div>
    <div id="showList">${showListHTML()}</div>`;
  return h;
}
function showListHTML(){
  const today = new Date().toISOString().slice(0,10), when = S.showWhen || 'upcoming';
  const q = (S.showQ||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shows = Object.entries(S.shows).filter(([id, s]) => {
    const c = normShow(s), st = showStatus(s);
    const upcoming = !s.date || s.date >= today || st.k === 'ring';
    if(when === 'upcoming' && !upcoming) return false;
    if(when === 'past' && upcoming) return false;
    if(S.showSer && s.seriesId !== S.showSer) return false;
    if(S.showMine && !exOf(S.entries[S.uid], id).length) return false;
    if(!q.length) return true;
    const ser = s.seriesId && S.series[s.seriesId];
    const hay = [s.name, s.location, longDate(s.date), s.date && new Date(s.date+'T12:00').toLocaleDateString(undefined,{month:'long'}), speciesLine(c),
      SP_ORDER.filter(sp => c.sm[sp]).map(sp => SPECIES[sp].sm + ' ' + SPECIES[sp].label).join(' '), ser && ser.name, st.label].join(' ').toLowerCase();
    return q.every(w => hay.includes(w));
  });
  shows.sort((a,b) => when === 'past' ? (b[1].date||'').localeCompare(a[1].date||'') : (a[1].date||'9999').localeCompare(b[1].date||'9999'));
  if(!shows.length) return `<div class="card empty"><h3>No shows match</h3><p class="muted">${when === 'upcoming' ? 'Try Past or All, or ' : 'Try '}a different search.</p></div>`;
  let h = `<div class="muted small" style="margin:0 0 8px">${shows.length} show${shows.length===1?'':'s'}</div>`;
  for(const [id, s] of shows){
    const c = normShow(s), st = showStatus(s), my = exOf(S.entries[S.uid], id);
    const head = my.reduce((n, ex) => n + (ex.animals||[]).length, 0), smN = my.reduce((n, ex) => n + smList(ex).length, 0);
    const ser = s.seriesId && S.series[s.seriesId];
    h += `<div class="card showcard"><div class="body">
      <h3>${esc(s.name || 'Untitled show')}</h3>
      <div class="muted small">${esc([longDate(s.date), s.location].filter(Boolean).join(' · '))}</div>
      <div class="small" style="margin-top:4px">${esc(speciesLine(c))}${ser ? ` · <a href="#series-${esc(s.seriesId)}">${esc(ser.name)}</a>` : ''}</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="chip ${st.k}">${esc(st.label)}</span>
      ${head || smN ? `<span class="small">You’re entered: <b>${head} head</b>${smN ? `, ${smN} showmanship` : ''}</span>` : ''}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn grn" href="#live-${esc(id)}" style="text-decoration:none">Follow live</a>
        <a class="btn" href="#results-${esc(id)}" style="text-decoration:none">Results</a>
        ${s.entriesOpen || isManager(id) ? `<a class="btn" href="#enter-${esc(id)}" style="text-decoration:none">${head||smN ? 'Edit entries' : 'Enter'}</a>` : ''}
        ${isManager(id) ? `<a class="btn ghost" href="#office-${esc(id)}" style="text-decoration:none">Show office</a>
          <button class="btn danger" data-act="delShowId" data-id="${esc(id)}">${S.confirmDel==='show|'+id ? 'Tap again to delete' : 'Delete'}</button>` : ''}
      </div></div>`;
  }
  return h;
}

/* ================= view: account ================= */
const ROLE_TEXT = {admin:'Admin – can create shows and series, manage every show, and set user roles', manager:'Show manager – can create shows and series and run the shows you manage', exhibitor:'Exhibitor – can keep a barn and enter shows'};
function authCardHTML(){
  const tab = S.authTab || 'login';
  const tabs = `<div class="seg">${[['login','Log in'],['signup','Create account'],['forgot','Forgot password']].map(([k,l]) => `<button class="${tab===k?'on':''}" data-act="authTab" data-k="${k}">${l}</button>`).join('')}</div>`;
  const msg = (S.authMsg ? `<div class="banner info">${esc(S.authMsg)}</div>` : '') + (S.authErr ? `<div class="banner warn"><b>Couldn’t ${tab==='signup'?'create the account':tab==='forgot'?'send the reset email':'log in'}.</b> ${esc(S.authErr)}${S.authErrRaw && S.authErrRaw !== S.authErr ? `<div class="small muted" style="margin-top:4px">Details: ${esc(S.authErrRaw)}</div>` : ''}</div>` : '');
  let form = '';
  if(tab === 'login') form = `<form data-form="login"><label>Email</label><input class="in" name="email" type="email" autocomplete="email" required>
    <label style="margin-top:10px">Password</label><input class="in" name="password" type="password" autocomplete="current-password" required>
    <div class="row-actions"><button class="btn pri" type="submit">Log in</button></div></form>`;
  if(tab === 'signup') form = `<form data-form="signup"><label>Your name</label><input class="in" name="name" autocomplete="name" required placeholder="Parent or manager name">
    <label style="margin-top:10px">Email</label><input class="in" name="email" type="email" autocomplete="email" required>
    <label style="margin-top:10px">Password (8+ characters)</label><input class="in" name="password" type="password" minlength="8" autocomplete="new-password" required>
    <p class="muted small">One account per family is enough. You’ll add each showman in My barn.</p>
    <div class="row-actions"><button class="btn pri" type="submit">Create account</button></div></form>`;
  if(tab === 'forgot') form = `<form data-form="forgot"><label>Email</label><input class="in" name="email" type="email" autocomplete="email" required>
    <div class="row-actions"><button class="btn pri" type="submit">Email me a reset link</button></div></form>`;
  return `<div class="card" style="max-width:440px;margin:0 auto"><h3>Your ShowSchedule account</h3>${tabs}${msg}${form}</div>`;
}
function viewAccount(){
  if(S.recovery) return `<div class="card" style="max-width:440px;margin:0 auto"><h3>Set a new password</h3>
    <form data-form="newpw"><label>New password</label><input class="in" name="password" type="password" minlength="8" autocomplete="new-password" required>
    <div class="row-actions"><button class="btn pri" type="submit">Save password</button></div></form></div>`;
  if(!S.uid) return authCardHTML();
  const managed = Object.entries(S.shows).filter(([id, s]) => (s.managers||[]).includes(S.uid));
  return `<div class="card"><h3>Your account</h3>
    <p style="margin:6px 0">Logged in as <b>${esc(S.myName)}</b> <span class="muted small">${esc(S.email)}</span></p>
    <p class="muted small" style="margin:0 0 12px">${esc(ROLE_TEXT[S.role] || ROLE_TEXT.exhibitor)}${managed.length ? ` · Manager of ${managed.length} show${managed.length===1?'':'s'}` : ''}</p>
    <form data-form="name" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><div style="flex:1;min-width:200px"><label>Display name</label><input class="in" name="name" value="${esc(S.myName)}" required></div><button class="btn" type="submit">Save name</button></form>
    <div class="row-actions"><a class="btn" href="#barn" style="text-decoration:none">My barn</a>${S.isOwner ? `<a class="btn" href="#users" style="text-decoration:none">Users &amp; roles</a>` : ''}<span style="flex:1"></span><button class="btn danger" data-act="logout">Log out</button></div></div>
    ${S.role === 'exhibitor' ? `<p class="muted small">Running a show? Ask the site admin to make your account a show manager.</p>` : ''}`;
}
function viewWelcome(){
  if(!S.authReady) return loading();
  const today = new Date().toISOString().slice(0,10);
  const soon = Object.entries(S.shows).filter(([, x]) => !x.date || x.date >= today || showStatus(x).k === 'ring')
    .sort((a,b) => (a[1].date||'9999').localeCompare(b[1].date||'9999')).slice(0, 4);
  const liveNow = soon.filter(([, x]) => showStatus(x).k === 'ring');
  return `<div class="landing">
    <section class="pitch">
      <div class="eyebrow">Livestock show entries · live ring · points</div>
      <h2 class="headline">Know what’s in the ring before you hear it on the speaker.</h2>
      <p class="lede">ShowSchedule keeps your family’s showmen and animals in one barn, enters you in shows with a few taps, and follows the ring live so you’re never late to your class.</p>
      <ul class="perks">
        <li><b>Enter once, show all season.</b> Save your kids and your cattle, sheep, goats and hogs, then check boxes for each show.</li>
        <li><b>Live ring updates.</b> See what’s in the ring, on deck and in the hole, with a countdown to your classes.</li>
        <li><b>Results and series points.</b> Placings, champions and season standings as soon as the judge decides.</li>
        <li><b>Built for show managers too.</b> Divisions, class splits, back numbers, ring control and placings in one place.</li>
      </ul>
    </section>
    <section class="door">${authCardHTML()}
      <p class="muted small" style="text-align:center;margin:10px 0 0">Just watching? <a href="#shows">Follow a show without an account →</a></p>
    </section>
  </div>
  ${S.loadErr && !S.showsLoaded ? `<div style="margin-top:18px">${loadErrHTML()}</div>` : ''}
  ${soon.length ? `<h2>${liveNow.length ? 'Happening now & coming up' : 'Coming up'}</h2><div class="soon">${soon.map(([id, x]) => { const st = showStatus(x); return `<a class="mini" href="#live-${esc(id)}" style="text-decoration:none;color:inherit">
      <div class="lab">${esc(shortDate(x.date) || 'Date TBA')}${x.location ? ' · ' + esc(x.location) : ''}</div><div class="t">${esc(x.name || 'Untitled show')}</div>
      <span class="chip ${st.k}">${esc(st.label)}</span></a>`; }).join('')}</div>` : ''}`;
}
function viewUsers(){
  if(!S.isOwner) return `<div class="card empty"><h3>Admins only</h3></div>`;
  if(!S.users){
    if(!S.usersLoading){ S.usersLoading = true; sb.from('profiles').select('id,display_name,role,created_at').order('display_name').then(({data, error}) => { S.usersLoading = false; S.users = error ? [] : data; if(error) toast(error.message, true); render(); }); }
    return loading();
  }
  const q = (S.userQ||'').toLowerCase();
  const rows = S.users.filter(u => !q || (u.display_name||'').toLowerCase().includes(q));
  return `<div class="who-bar"><h2 style="margin:0">Users &amp; roles</h2><span class="muted small">${S.users.length} accounts</span></div>
    <p class="muted" style="margin-top:0">Show managers can create shows and series. Admins can do everything, including this page.</p>
    <div class="card"><input class="in" id="userQ" placeholder="Search by name" value="${esc(S.userQ||'')}" style="margin-bottom:8px">
    <table><thead><tr><th>Name</th><th>Joined</th><th>Role</th></tr></thead><tbody>${rows.map(u => `<tr><td><b>${esc(u.display_name||'—')}</b>${u.id===S.uid?' <span class="pill">You</span>':''}</td><td class="small muted">${esc(new Date(u.created_at).toLocaleDateString())}</td>
      <td><select class="in" style="width:auto" data-role-user="${esc(u.id)}"${u.id===S.uid?' disabled':''}>${['exhibitor','manager','admin'].map(r => `<option value="${r}"${u.role===r?' selected':''}>${r[0].toUpperCase()+r.slice(1)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`;
}

/* ================= view: barn ================= */
function getBarnDraft(){
  if(!S.barnDraft) S.barnDraft = S.barn ? clone({showmen:S.barn.showmen||[], animals:S.barn.animals||[]}) : {showmen:[], animals:[]};
  return S.barnDraft;
}
function opts(list, val, ph){
  const all = val && !list.includes(val) ? [...list, val] : list;
  return (ph != null ? `<option value="">${esc(ph)}</option>` : '') + all.map(o => `<option${o===val?' selected':''}>${esc(o)}</option>`).join('');
}
function breedsFor(sp){ const s = new Set(SPECIES[sp].breeds); Object.values(S.shows).forEach(x => { const c = normShow(x); DIVS.filter(d => d.species===sp).forEach(d => c.divs[d.key].breeds.forEach(b => s.add(b))); }); return [...s].sort(); }
function barnTabsHTML(d){
  const tab = S.barnTab || 'showmen';
  const link = (k, label, n) => `<a href="#barn-${k}" class="${tab===k?'on':''}">${label} <span class="cnt">${n}</span></a>`;
  return `<div class="subtabs">${link('showmen', 'Showmen', d.showmen.length)}${link('animals', 'Animals', d.animals.length)}</div>`;
}
function viewBarn(){
  if(S.noDb || !S.uid) return signInMsg('set up your barn');
  if(!S.barnLoaded) return loading();
  if(S.canWrite === false) return viewOnlyMsg();
  const d = getBarnDraft(), tab = S.barnTab || 'showmen';
  let h = `<div class="who-bar"><h2 style="margin:0">My barn</h2><span class="muted small">${S.myName ? 'Signed in as <b>'+esc(S.myName)+'</b>' : ''}</span></div>
    <p class="muted" style="margin-top:0">Save your showmen and animals once. Each show, just check who and what you’re bringing. Only you can see your barn. A show sees only what you enter.</p>
    ${barnTabsHTML(d)}`;
  h += tab === 'animals' ? barnAnimalsHTML(d) : barnShowmenHTML(d);
  h += `<div class="savebar"><span class="muted small" style="flex:1">${S.barnDirty ? 'Unsaved changes to your barn' : (S.barn ? 'All changes saved' : '')}</span><button class="btn pri" data-act="saveBarn">Save barn</button></div>`;
  return h;
}
function barnShowmenHTML(d){
  let h = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3 style="margin:0">Showmen</h3><button class="btn sm pri" data-act="addSm">+ Add showman</button></div>`;
  if(!d.showmen.length) h += `<p class="muted">Add each kid (or adult) who shows. Their birth date sets their showmanship division automatically each year.</p>`;
  d.showmen.forEach((sm, i) => {
    const age = ageFor(sm, {ageJan1:true, date:''});
    const mine = d.animals.filter(a => a.showmanId === sm.id);
    const bySp = SP_ORDER.map(sp => [sp, mine.filter(a => (a.species||'cattle') === sp).length]).filter(([, n]) => n);
    h += `<div class="exh" style="margin-top:12px"><div class="grid g4">
      <div><label>First name</label><input class="in" data-b="showmen.${i}.first" value="${esc(sm.first)}"></div>
      <div><label>Last name</label><input class="in" data-b="showmen.${i}.last" value="${esc(sm.last)}"></div>
      <div><label>Birth date</label><input class="in" type="date" data-b="showmen.${i}.birthdate" value="${esc(sm.birthdate)}"></div>
      <div><label>Hometown / club</label><input class="in" data-b="showmen.${i}.town" value="${esc(sm.town)}"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px">
        <span class="muted small">${sm.birthdate ? `Showmanship age this year: <b>${age}</b>` : (sm.age ? `Age on file: ${esc(sm.age)}. Add a birth date so it updates each year.` : 'Birth date sets their showmanship division.')}</span>
        <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn sm" data-act="barnSmAnimals" data-id="${esc(sm.id)}">${mine.length ? `${mine.length} animal${mine.length===1?'':'s'}${bySp.length ? ' · ' + bySp.map(([sp, n]) => `${n} ${SPECIES[sp].label.toLowerCase()}`).join(', ') : ''}` : 'Add animals'} →</button>
          <button class="btn sm ghost" data-act="rmSm" data-i="${i}">Remove</button></span></div></div>`;
  });
  return h + `</div>`;
}
function barnAnimalsHTML(d){
  if(!d.showmen.length) return `<div class="card empty"><h3>Add a showman first</h3><p class="muted">Every animal needs someone to show it.</p><a class="btn pri" href="#barn-showmen" style="text-decoration:none">Go to Showmen</a></div>`;
  const fSm = S.barnSm || '', fSp = S.barnSp || '';
  const shown = d.animals.map((an, i) => ({an, i})).filter(({an}) =>
    (!fSm || (fSm === 'none' ? !d.showmen.some(x => x.id === an.showmanId) : an.showmanId === fSm)) && (!fSp || (an.species||'cattle') === fSp));
  const unassigned = d.animals.filter(a => !d.showmen.some(x => x.id === a.showmanId)).length;
  let h = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Animals</h3><button class="btn sm pri" data-act="addBa">+ Add animal</button></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px">
      <select class="in" id="barnSm" style="width:auto"><option value="">All showmen</option>${d.showmen.map(sm => `<option value="${esc(sm.id)}"${fSm===sm.id?' selected':''}>${esc(smName(sm)||'Unnamed')}</option>`).join('')}${unassigned ? `<option value="none"${fSm==='none'?' selected':''}>No showman yet (${unassigned})</option>` : ''}</select>
      <select class="in" id="barnSp" style="width:auto"><option value="">All species</option>${SP_ORDER.map(sp => `<option value="${sp}"${fSp===sp?' selected':''}>${esc(SPECIES[sp].label)}</option>`).join('')}</select>
      ${fSm || fSp ? `<button class="btn sm ghost" data-act="barnClear">Show all</button>` : ''}
    </div>`;
  if(!d.animals.length) h += `<p class="muted">Add each animal and who shows it. Market weights can be updated for each show when you enter.</p>`;
  else if(!shown.length) h += `<p class="muted">No animals match these filters.</p>`;
  else h += `<div class="muted small">${shown.length === d.animals.length ? `${d.animals.length} animal${d.animals.length===1?'':'s'}` : `Showing ${shown.length} of ${d.animals.length}`}</div>`;
  for(const {an, i} of shown){
    const sp = an.species || 'cattle', owner = d.showmen.find(x => x.id === an.showmanId);
    h += `<div class="exh" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px"><b>${esc(an.name || 'New animal')}</b><span class="pill">${esc(SPECIES[sp].label)}${owner ? ' · ' + esc(owner.first || '') : ' · <span class="warn-t">needs a showman</span>'}</span></div>
      <div class="grid g4">
      <div><label>Species</label><select class="in" data-b="animals.${i}.species">${SP_ORDER.map(k => `<option value="${k}"${k===sp?' selected':''}>${SPECIES[k].label}</option>`).join('')}</select></div>
      <div><label>Animal name</label><input class="in" data-b="animals.${i}.name" value="${esc(an.name)}"></div>
      <div><label>Breed</label><select class="in" data-b="animals.${i}.breed">${opts(breedsFor(sp), an.breed, 'Choose breed')}</select></div>
      <div><label>Sex</label><select class="in" data-b="animals.${i}.sex">${opts(SPECIES[sp].sexes, an.sex, 'Choose')}</select></div>
      <div><label>Shown by</label><select class="in" data-b="animals.${i}.showmanId"><option value="">Choose showman</option>${d.showmen.map(sm => `<option value="${esc(sm.id)}"${sm.id===an.showmanId?' selected':''}>${esc(smName(sm)||'Unnamed')}</option>`).join('')}</select></div>
      <div><label>Tag / ear notch / reg #</label><input class="in" data-b="animals.${i}.tag" value="${esc(an.tag)}"></div>
      <div><label>Birth date</label><input class="in" type="date" data-b="animals.${i}.birthdate" value="${esc(an.birthdate)}"></div>
      <div><label>Latest weight (lb)</label><input class="in" type="number" min="0" data-b="animals.${i}.weight" value="${esc(an.weight)}"></div>
      </div><div style="text-align:right;margin-top:8px"><button class="btn sm ghost" data-act="rmBa" data-i="${i}">Remove</button></div></div>`;
  }
  return h + `</div>`;
}

/* ================= view: enter ================= */
function getEnterDraft(){
  const id = S.showId;
  if(!S.enterDraft[id]){
    const d = {sm:{}, an:{}, w:{}, div:{}};
    for(const ex of exOf(S.entries[S.uid])){
      d.sm[ex.id] = {}; smList(ex).forEach(sp => d.sm[ex.id][sp] = true);
      for(const an of (ex.animals||[])){ d.an[an.id] = true; if(an.weight) d.w[an.id] = an.weight; if(an.div) d.div[an.id] = an.div; }
    }
    S.enterDraft[id] = d;
  }
  return S.enterDraft[id];
}
function viewEnter(){
  if(S.noDb || !S.uid) return signInMsg('enter');
  if(!S.showsLoaded || !S.entriesLoaded || !S.barnLoaded) return loading();
  if(!S.shows[S.showId]) return notFound();
  if(S.canWrite === false) return viewOnlyMsg();
  const c = cfg(), mine = exOf(S.entries[S.uid]), entered = mine.length > 0;
  if(!c.entriesOpen && !isManager()){
    let h = `<div class="banner warn"><b>Entries are closed.</b> Contact the show manager for changes or scratches.</div>`;
    if(entered){ h += `<div class="card"><h3>Your entries</h3>`; mine.forEach(ex => { h += `<div class="fx"><div class="who">${esc(ex.name)} ${smList(ex).map(sp => `<span class="pill">${esc(SPECIES[sp].sm)}</span>`).join(' ')}</div><div class="small muted">${(ex.animals||[]).map(a=>esc(`${a.name} · ${a.breed} ${a.sex}`)).join('<br>')||'No animals'}</div></div>`; }); h += `</div>`; }
    return h;
  }
  const barn = S.barn || {showmen:[], animals:[]};
  if(!(barn.showmen||[]).length) return `<div class="card empty"><h3>Set up your barn first</h3><p class="muted">Add your showmen and animals once in My barn, then come back to pick what you’re bringing.</p><a class="btn pri" href="#barn" style="text-decoration:none">Go to My barn</a></div>`;
  const d = getEnterDraft(), smSpecies = SP_ORDER.filter(sp => c.sm[sp]);
  let h = `<div class="banner info"><b>${esc(c.name)}</b> offers: ${esc(speciesLine(c))}${smSpecies.length ? '; showmanship for ' + esc(smSpecies.map(sp => SPECIES[sp].label.toLowerCase()).join(', ')) : ''}.${c.order ? ' The show order is set. New entries are added when the manager rebuilds it.' : ''}</div>`;
  for(const sm of barn.showmen){
    const age = ageFor(sm, c), dv = divisionFor(age, c);
    const animals = (barn.animals||[]).filter(a => a.showmanId === sm.id);
    h += `<div class="card"><h3>${esc(smName(sm)||'Unnamed')}</h3><div class="muted small">${age ? `Age ${age}${c.ageJan1?' as of Jan 1':''}${dv ? ' · '+esc(ageName(dv.name))+' showmanship' : ''}` : 'No birth date in barn'}${sm.town?' · '+esc(sm.town):''}</div>`;
    if(smSpecies.length){
      h += `<div class="pick"><div class="body"><b>Showmanship</b>${!age ? '<br><span class="warn-t">Add a birth date in My barn</span>' : (!dv ? '<br><span class="warn-t">Age is outside this show’s divisions</span>' : '')}
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px">${smSpecies.map(sp => `<label class="check"><input type="checkbox" data-e="sm.${esc(sm.id)}.${sp}"${(d.sm[sm.id]||{})[sp]?' checked':''}> ${esc(SPECIES[sp].sm)}</label>`).join('')}</div></div></div>`;
    }
    if(!animals.length) h += `<div class="pick muted small">No animals assigned to ${esc(sm.first||'this showman')} in your barn.</div>`;
    for(const an of animals){
      const sp = an.species || 'cattle', cands = divCandidates(sp, an.sex, c);
      const div = cands.includes(d.div[an.id]) ? d.div[an.id] : cands[0];
      const dc = c.divs[div];
      const warn = !cands.length ? `This show has no ${SPECIES[sp].label.toLowerCase()} class for a ${an.sex||'animal'}` : (dc && !dc.breeds.includes(an.breed) ? `“${an.breed}” isn’t on this show’s breed list` : '');
      h += `<div class="pick"><input type="checkbox" id="an-${esc(an.id)}" data-e="an.${esc(an.id)}"${d.an[an.id] && cands.length ?' checked':''}${cands.length?'':' disabled'}>
        <label for="an-${esc(an.id)}" class="body" style="margin:0;color:var(--ink);font-size:1rem"><b>${esc(an.name||'Unnamed')}</b>${an.tag?` <span class="muted small">#${esc(an.tag)}</span>`:''}<br><span class="muted small">${esc(SPECIES[sp].label)} · ${esc(an.breed)} ${esc(an.sex)}${an.birthdate?' · born '+fmtD(an.birthdate):''}${cands.length===1 ? ' · '+esc(DIV[div].label) : ''}</span>${warn?`<br><span class="warn-t">${esc(warn)}</span>`:''}</label>
        ${cands.length > 1 ? `<select class="in" style="width:auto" data-e="div.${esc(an.id)}">${cands.map(k => `<option value="${k}"${k===div?' selected':''}>${esc(DIV[k].label)}</option>`).join('')}</select>` : ''}
        ${div && DIV[div].market ? `<input class="in w" type="number" min="0" placeholder="Weight" data-e="w.${esc(an.id)}" value="${esc(d.w[an.id] ?? an.weight ?? '')}" title="Weight for this show">` : ''}</div>`;
    }
    h += `</div>`;
  }
  h += `<div class="savebar"><span class="muted small" style="flex:1"><a href="#barn">Edit My barn</a> to add animals or showmen.</span>
    ${entered ? `<button class="btn danger" data-act="withdraw">${S.confirmDel==='withdraw'?'Tap again to withdraw':'Withdraw'}</button>` : ''}
    <button class="btn pri" data-act="saveEnter">${entered ? 'Update entries' : 'Submit entries'}</button></div>`;
  return h;
}

/* ================= view: live ================= */
function viewLive(){
  if(S.noDb) return signInMsg('follow the show');
  if(!S.showsLoaded || !S.entriesLoaded) return loading();
  if(!S.shows[S.showId]) return notFound();
  const info = ringInfo(), {c, list, ci, done} = info;
  let h = '';
  if(!c.order && list.length) h += `<div class="banner"><b>Draft class list.</b> Classes are built automatically from entries and may change until the show manager locks the order.</div>`;
  if(!list.length) return h + `<div class="card empty"><h3>No classes yet</h3><p class="muted">Classes appear here as entries come in.${c.entriesOpen ? ` <a href="#enter-${esc(S.showId)}">Enter now</a>.` : ''}</p></div>`;
  const mine = myKeys();
  const allDone = list.every(x => done.has(x.id)) && ci < 0;
  if(allDone) h += `<div class="hero idle"><div class="lab">Show complete</div><div class="t">That’s a wrap</div><div class="s">Every class has shown. <a href="#results-${esc(S.showId)}" style="color:#fff">See results</a>.</div></div>`;
  else if(ci >= 0){ const now = list[ci]; h += `<div class="hero"><div class="lab"><span class="dot"></span>In the ring now · Class ${ci+1} of ${list.length}</div><div class="t">${esc(now.title)}</div><div class="s">${subLine(now)}</div>${lineupHTML(now, mine)}</div>`; }
  else h += `<div class="hero idle"><div class="lab">Show hasn’t started</div><div class="t">${esc(c.name)}</div><div class="s">${list.length} classes · ${activeAnimals().length} head entered</div></div>`;
  if(!allDone){
    const n1 = list[ci+1], n2 = list[ci+2];
    if(n1 || n2){
      h += `<div class="next2">`;
      if(n1) h += `<div class="mini deck" data-act="jump" data-id="${esc(n1.id)}"><div class="lab">${ci>=0?'On deck':'First up'}</div><div class="t">${esc(n1.title)}</div><div class="muted small">${subLine(n1)}</div></div>`;
      if(n2) h += `<div class="mini hole" data-act="jump" data-id="${esc(n2.id)}"><div class="lab">${ci>=0?'In the hole':'Then'}</div><div class="t">${esc(n2.title)}</div><div class="muted small">${subLine(n2)}</div></div>`;
      h += `</div>`;
    }
  }
  if(mine.size) h += `<div class="card"><h3>Your entries</h3><div class="fx" style="padding:0">${followListHTML(mine, info)}</div></div>`;
  h += `<div class="card find"><h3>Find an exhibitor</h3><input id="search" type="search" placeholder="Name, animal, or back #" value="${esc(S.search)}" autocomplete="off"><div class="fres" id="fres">${findResultsHTML()}</div></div>`;
  h += `<h2>Show order</h2><div class="card listcard">`;
  let lastSp = null;
  list.forEach((cls, i) => {
    const sp = cls.species || (cls.div && DIV[cls.div] ? DIV[cls.div].species : null);
    if(sp && sp !== lastSp && SP_ORDER.filter(x => list.some(l => (l.species || (l.div && DIV[l.div]?.species)) === x)).length > 1){
      h += `<div class="cls" style="cursor:default;background:#efe7d6"><b class="cond" style="font-size:1.05rem">${esc(SPECIES[sp].label)}</b></div>`; lastSp = sp;
    }
    const st = statusOf(i, info), open = S.expanded.has(cls.id), isMine = cls.members.some(k => mine.has(k));
    h += `<div class="cls st-${st.k}${isMine?' mine':''}" id="c-${i}" data-act="toggle" data-id="${esc(cls.id)}">
      <div class="num">${i+1}</div><div class="body"><div class="t">${esc(cls.title)}</div><div class="s">${subLine(cls)}</div></div>
      <span class="chip ${st.k}">${esc(st.label)}</span></div>`;
    if(open) h += lineupHTML(cls, mine);
  });
  return h + `</div>`;
}

/* ================= view: results / scoreboard ================= */
function viewResults(){
  if(S.noDb) return signInMsg('see results');
  if(!S.showsLoaded || !S.entriesLoaded) return loading();
  const s = S.shows[S.showId]; if(!s) return notFound();
  const c = cfg(), ser = s.seriesId && S.series[s.seriesId];
  let h = `<div class="who-bar"><h2 style="margin:0">Results &amp; points</h2>${ser ? `<a class="btn sm ghost" href="#series-${esc(s.seriesId)}" style="text-decoration:none">${esc(ser.name)} standings →</a>` : ''}</div>`;
  if(!s.order) return h + `<div class="card empty"><h3>No results yet</h3><p class="muted">Results and points show here once the show manager sets the order and records placings.</p></div>`;
  const recs = scoreShow(S.showId), placed = recs.filter(r => r.place != null);
  if(!placed.length) return h + `<div class="card empty"><h3>No placings recorded yet</h3><p class="muted">Points appear class by class as the show manager records placings.</p></div>`;
  h += `<p class="muted small" style="margin-top:0">Points are ${ser ? `scored with ${esc(ser.name)} rules` : 'scored with the default rules'}: ${rulesText(rulesFor(S.showId))}</p>`;
  const mine = myKeys(), my = placed.filter(r => mine.has(r.key));
  if(my.length){
    h += `<div class="card"><h3>Your results</h3><table><tbody>${my.sort((a,b)=>b.total-a.total).map(r => `<tr><td><b>${esc(r.animal || r.exName)}</b><br><span class="muted small">${esc(r.classTitle)}</span></td><td><span class="place p${r.place}">${ord(r.place)} of ${r.size}</span> ${r.award ? `<span class="award">${esc(r.award)}</span>` : ''}</td><td class="pts">${r.total}</td></tr>`).join('')}</tbody></table>
      <div style="text-align:right;margin-top:6px" class="small">Total: <b>${my.reduce((a,r)=>a+r.total,0)} pts</b></div></div>`;
  }
  h += `<div class="card"><h3>Entry scoreboard</h3><input class="in" id="resFilter" placeholder="Filter by name, animal, breed or division" value="${esc(S.resFilter)}" style="margin-bottom:8px"><div id="scoreTable" style="overflow-x:auto">${scoreTableHTML(placed)}</div></div>`;
  h += `<h2>Class results</h2>`;
  for(const cls of s.order){
    if(cls.kind === 'drive') continue;
    const res = ((s.results||{})[cls.id] || []).filter(k => S.lookup.has(k) && cls.members.includes(k)); if(!res.length) continue;
    h += `<div class="card" style="padding:12px 14px"><div class="t" style="font-weight:600">${esc(cls.title)}${cls.sub?` <span class="muted small">${esc(cls.sub)}</span>`:''}</div><div class="muted small">${res.length} shown</div>
      <div class="lineup" style="margin:8px 0 0">${res.map((k,i) => { const m = memberLabel(k), r = recs.find(x => x.key===k); return `<div class="row"><span class="place p${i+1}" style="margin:0">${ord(i+1)}</span><span class="back">${esc(m.back)}</span><div style="flex:1"><b>${esc(m.main)}</b> <span class="muted small">${esc(m.sub)}</span></div>${r && r.award ? `<span class="award">${esc(r.award)}</span>` : ''}<span class="pts">${r ? r.total : ''}</span></div>`; }).join('')}</div></div>`;
  }
  return h;
}
function scoreTableHTML(placed){
  const q = S.resFilter.trim().toLowerCase();
  const rows = placed.filter(r => !q || [r.exName, r.animal, r.breed, r.classTitle, r.div && DIV[r.div].label].join(' ').toLowerCase().includes(q))
    .sort((a,b) => b.total - a.total || (a.exName||'').localeCompare(b.exName||''));
  if(!rows.length) return `<div class="muted small">No matches.</div>`;
  return `<table><thead><tr><th>#</th><th>Entry</th><th>Class</th><th>Placing</th><th style="text-align:right">Points</th></tr></thead><tbody>${rows.map((r,i) => `<tr>
    <td class="rank">${i+1}</td>
    <td><span class="back" style="font-size:.8rem;min-width:36px;display:inline-block">${esc(r.kind==='an' ? backOf(r.key) : memberLabel(r.key).back)}</span> <b>${esc(r.animal || r.exName)}</b><br><span class="muted small">${esc(r.kind==='an' ? r.exName : (r.town||''))}</span></td>
    <td class="small">${esc(r.classTitle)}</td>
    <td class="small">${ord(r.place)} of ${r.size}${r.award ? `<br><span class="award">${esc(r.award)}</span>` : ''}${r.overallPlace ? `<br><span class="award" style="background:var(--green)">Overall ${ord(r.overallPlace)}</span>` : ''}</td>
    <td class="pts" title="${esc(`Class ${r.placePts}${r.award ? `, ${r.award} base ${r.basePts} + ${r.bonus}` : ''}${r.overallPts ? `, overall +${r.overallPts}` : ''}`)}">${r.total}</td></tr>`).join('')}</tbody></table>`;
}
function rulesText(R){
  const base = R.mode === 'table' ? `placings earn ${(R.table||[]).join(', ')} points` : 'placings earn one point per animal in the class (1st of 8 = 8 points, last = 1)';
  return `${base}; champion +${R.champBonus}, reserve +${R.resBonus}${R.champTop ? ' on top of the best class winner’s points' : ''}${(R.overall||[]).length ? `; overall placings +${R.overall.join(', +')}` : ''}.`;
}

/* ================= view: series ================= */
function viewSeriesList(){
  if(S.noDb) return signInMsg('see series');
  if(!S.seriesLoaded) return loading();
  let h = `<div class="who-bar"><h2 style="margin:0">Show series</h2>${S.isAdmin ? `<button class="btn pri" data-act="newSeries">+ New series</button>` : ''}</div>`;
  const list = Object.entries(S.series).sort((a,b) => String(b[1].year||'').localeCompare(String(a[1].year||'')));
  if(!list.length) return h + `<div class="card empty"><h3>No series yet</h3><p class="muted">A series groups shows and keeps season-long point totals.${S.isAdmin ? ' Create one, then pick it in each show’s settings.' : ''}</p></div>`;
  for(const [id, r] of list){
    const n = Object.values(S.shows).filter(s => s.seriesId === id).length;
    h += `<div class="card showcard"><div class="body"><h3>${esc(r.name)}</h3><div class="muted small">${esc(r.year||'')} · ${n} show${n===1?'':'s'}</div></div><a class="btn grn" href="#series-${esc(id)}" style="text-decoration:none">Standings</a></div>`;
  }
  return h;
}
function viewSeries(){
  if(S.noDb) return signInMsg('see standings');
  if(!S.seriesLoaded || !S.showsLoaded || !S.entriesLoaded) return loading();
  const ser = S.series[S.seriesId]; if(!ser) return notFound();
  const {shows, cats, R} = seriesStandings(S.seriesId);
  let h = `<div class="who-bar"><div><h2 style="margin:0">${esc(ser.name)}</h2><div class="muted small">${esc(ser.year||'')} season · ${shows.length} show${shows.length===1?'':'s'}</div></div>${S.isAdmin ? `<button class="btn sm ghost" data-act="toggleSerEdit">${S.serEdit ? 'Close settings' : 'Series settings'}</button>` : ''}</div>`;
  if(S.serEdit && S.isAdmin) h += seriesEditorHTML(ser);
  h += `<p class="muted small" style="margin-top:0">Scoring: ${rulesText(R)} ${R.minShows ? `Must show at ${R.minShows}+ shows to be eligible.` : ''} ${R.bestN ? `Best ${R.bestN} shows count.` : ''} Ties go to the most shows attended.</p>`;
  if(!shows.length) return h + `<div class="card empty"><h3>No shows in this series yet</h3><p class="muted">Show managers add a show to the series in its settings.</p></div>`;
  if(!cats.size) return h + `<div class="card empty"><h3>No points yet</h3><p class="muted">Standings fill in as placings are recorded at series shows.</p></div>`;
  const keys = ['overall', ...DIVS.map(d => 'div:'+d.key), ...SP_ORDER.map(sp => 'sm:'+sp)].filter(k => cats.has(k));
  if(!cats.has(S.serCat)) S.serCat = keys[0];
  h += `<div class="seg">${keys.map(k => `<button class="${k===S.serCat?'on':''}" data-act="serCat" data-k="${esc(k)}">${esc(cats.get(k).label)}</button>`).join('')}</div>`;
  const cat = cats.get(S.serCat);
  let rows = [...cat.rows.values()];
  const isDiv = S.serCat.startsWith('div:');
  if(isDiv){
    const breeds = [...new Set(rows.map(r => r.breed))].sort();
    if(S.serBreed && !breeds.includes(S.serBreed)) S.serBreed = '';
    h += `<div style="margin-bottom:10px"><select class="in" style="width:auto" id="serBreed"><option value="">All breeds</option>${breeds.map(b => `<option${b===S.serBreed?' selected':''}>${esc(b)}</option>`).join('')}</select></div>`;
    if(S.serBreed) rows = rows.filter(r => r.breed === S.serBreed);
  }
  rows.sort((a,b) => (b.eligible - a.eligible) || b.total - a.total || b.shows - a.shows || (a.name||'').localeCompare(b.name||''));
  h += `<div class="card" style="overflow-x:auto"><table><thead><tr><th>#</th><th>${isDiv ? 'Animal' : 'Exhibitor'}</th>${isDiv ? '<th>Breed</th>' : ''}${shows.map(([sid, s]) => `<th style="text-align:right" title="${esc(s.name)}"><a href="#results-${esc(sid)}">${esc(shortDate(s.date) || (s.name||'').slice(0,10))}</a></th>`).join('')}<th style="text-align:right">Total</th></tr></thead><tbody>`;
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    if(!prev || r.total !== prev.total || r.shows !== prev.shows || r.eligible !== prev.eligible) rank = i + 1;
    prev = r;
    h += `<tr class="${r.eligible ? '' : 'inel'}"><td class="rank">${r.eligible ? rank : '–'}</td><td><b>${esc(r.name)}</b><br><span class="muted small">${esc(r.sub||'')}${r.eligible ? '' : ` · ${r.shows} of ${R.minShows} shows`}</span></td>${isDiv ? `<td class="small">${esc(r.breed)}</td>` : ''}
      ${shows.map(([sid]) => `<td style="text-align:right" class="small">${r.per[sid] != null ? r.per[sid] : '<span class="muted">–</span>'}</td>`).join('')}<td class="pts">${r.total}</td></tr>`;
  });
  h += `</tbody></table></div>`;
  return h;
}
function seriesEditorHTML(ser){
  if(!S.serDraft) S.serDraft = {name:ser.name, year:ser.year||'', rules: Object.assign({}, DEFAULT_RULES, ser.rules||{})};
  const d = S.serDraft, R = d.rules;
  return `<div class="card"><h3>Series settings</h3>
    <div class="grid g2"><div><label>Series name</label><input class="in" data-sr="name" value="${esc(d.name)}"></div><div><label>Season / year</label><input class="in" data-sr="year" value="${esc(d.year)}"></div></div>
    <h3 style="margin-top:14px">Point rules</h3>
    <p class="muted small" style="margin-top:0">Defaults follow the 2019–20 SDJPS handbook. Check them against the current rules and adjust.</p>
    <div class="grid g3">
      <div><label>Class placing points</label><select class="in" data-sr="rules.mode"><option value="size"${R.mode==='size'?' selected':''}>By class size (1st of 8 = 8 … last = 1)</option><option value="table"${R.mode==='table'?' selected':''}>Fixed table</option></select></div>
      <div><label>Fixed table (1st, 2nd, …)</label><input class="in" data-sr="rules.table" value="${esc((R.table||[]).join(', '))}"${R.mode==='table'?'':' disabled'}></div>
      <div><label>Overall placing bonus (1st, 2nd, …)</label><input class="in" data-sr="rules.overall" value="${esc((R.overall||[]).join(', '))}"></div>
      <div><label>Champion bonus</label><input class="in" type="number" data-sr="rules.champBonus" value="${esc(R.champBonus)}"></div>
      <div><label>Reserve bonus</label><input class="in" type="number" data-sr="rules.resBonus" value="${esc(R.resBonus)}"></div>
      <div><label>Shows needed to be eligible</label><input class="in" type="number" min="0" data-sr="rules.minShows" value="${esc(R.minShows)}"></div>
      <div><label>Count best ___ shows (0 = all)</label><input class="in" type="number" min="0" data-sr="rules.bestN" value="${esc(R.bestN)}"></div>
    </div>
    <div style="margin-top:10px"><label class="check"><input type="checkbox" data-sr="rules.champTop"${R.champTop?' checked':''}> Champion and reserve get the breed’s best class-winner points, plus their bonus</label></div>
    <div class="row-actions"><button class="btn danger" data-act="delSeries">${S.confirmDel==='series'?'Tap again to delete series':'Delete series'}</button><span style="flex:1"></span><button class="btn pri" data-act="saveSeries">Save series</button></div></div>`;
}

/* ================= view: show office ================= */
const newAn = () => ({id:'a'+rid(), name:'', tag:'', breed:'', sex:'', birthdate:'', weight:'', div:'', scratched:false});
const newEx = () => ({id:'e'+rid(), name:'', age:'', town:'', showmanship:[], animals:[newAn()]});
function getDraft(docId){
  if(!S.drafts[docId]){
    const c = cfg();
    S.drafts[docId] = clone(exOf(S.entries[docId])).map(ex => Object.assign(ex, {showmanship: smList(ex), animals:(ex.animals||[]).map(an => Object.assign(an, {div: animalDiv(an, c) || ''}))}));
    if(!S.drafts[docId].length) S.drafts[docId].push(newEx());
  }
  return S.drafts[docId];
}
function editorHTML(docId){
  const c = cfg(), draft = getDraft(docId), D = esc(docId), divs = enabledDivs(c), smSp = SP_ORDER.filter(sp => c.sm[sp]);
  let h = '';
  draft.forEach((ex, i) => {
    h += `<div class="exh"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">Exhibitor</h3>
        ${draft.length>1 ? `<button class="btn sm ghost" data-act="rmEx" data-doc="${D}" data-i="${i}">Remove exhibitor</button>`:''}</div>
      <div class="grid g3">
        <div><label>Exhibitor name</label><input class="in" data-doc="${D}" data-path="${i}.name" value="${esc(ex.name)}"></div>
        <div><label>Age</label><input class="in" type="number" min="3" max="25" data-doc="${D}" data-path="${i}.age" value="${esc(ex.age)}"></div>
        <div><label>Hometown or club</label><input class="in" data-doc="${D}" data-path="${i}.town" value="${esc(ex.town)}"></div></div>
      ${smSp.length ? `<div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap">${smSp.map(sp => `<label class="check"><input type="checkbox" data-doc="${D}" data-smsp="${i}.${sp}"${ex.showmanship.includes(sp)?' checked':''}> ${esc(SPECIES[sp].sm)}</label>`).join('')}</div>` : ''}`;
    (ex.animals||[]).forEach((an, j) => {
      const A = `${i}.animals.${j}`, dv = DIV[an.div], dc = an.div && c.divs[an.div];
      h += `<div class="animal"><div class="ah"><span class="pill">Animal ${j+1}${an.scratched?' · Scratched':''}</span>
          <span style="display:flex;gap:8px;align-items:center"><label class="check small"><input type="checkbox" data-doc="${D}" data-path="${A}.scratched"${an.scratched?' checked':''}> Scratch</label>
          <button class="btn sm ghost" data-act="rmAn" data-doc="${D}" data-i="${i}" data-j="${j}">Remove</button></span></div>
        <div class="grid g3">
          <div><label>Division</label><select class="in" data-doc="${D}" data-path="${A}.div"><option value="">Choose</option>${divs.map(d => `<option value="${d.key}"${d.key===an.div?' selected':''}>${esc(d.label)}</option>`).join('')}</select></div>
          <div><label>Breed</label><select class="in" data-doc="${D}" data-path="${A}.breed"${dv?'':' disabled'}>${opts(dc ? dc.breeds : [], an.breed, 'Choose breed')}</select></div>
          <div><label>Sex</label><select class="in" data-doc="${D}" data-path="${A}.sex"${dv?'':' disabled'}>${opts(dv ? dv.sexes : [], an.sex, 'Choose')}</select></div>
          <div><label>Animal name</label><input class="in" data-doc="${D}" data-path="${A}.name" value="${esc(an.name)}"></div>
          <div><label>Tag or reg #</label><input class="in" data-doc="${D}" data-path="${A}.tag" value="${esc(an.tag)}"></div>
          <div><label>${dv && dv.market ? 'Weight (lb)' : 'Birth date'}</label>${dv && dv.market ? `<input class="in" type="number" min="0" data-doc="${D}" data-path="${A}.weight" value="${esc(an.weight)}">` : `<input class="in" type="date" data-doc="${D}" data-path="${A}.birthdate" value="${esc(an.birthdate)}">`}</div></div></div>`;
    });
    h += `<div class="row-actions"><button class="btn sm" data-act="addAn" data-doc="${D}" data-i="${i}">+ Add animal</button></div></div>`;
  });
  const isOffice = docId.startsWith('office-');
  h += `<div class="row-actions">${isOffice ? `<button class="btn ghost" data-act="addEx" data-doc="${D}">+ Add another exhibitor</button>` : `<span class="muted small">Entered by the family from their barn. Changes apply to this show only.</span>`}
    <span style="flex:1"></span><button class="btn ghost" data-act="cancelEdit">Cancel</button>
    ${S.entries[docId] && exOf(S.entries[docId]).length ? `<button class="btn danger" data-act="delDoc" data-doc="${D}">${S.confirmDel===docId?'Tap again to remove':'Remove from show'}</button>` : ''}
    <button class="btn pri" data-act="saveDoc" data-doc="${D}">Save</button></div>`;
  return h;
}
function settingsHTML(c){
  const sd = k => S.setDraft[k] !== undefined ? S.setDraft[k] : null;
  const val = (k, v) => sd(k) ?? v;
  const mgrs = c.managers || [];
  let h = `<div class="grid g3" style="margin-top:12px">
      <div><label>Show name</label><input class="in" data-set="name" value="${esc(val('name', c.name))}"></div>
      <div><label>Date</label><input class="in" type="date" data-set="date" value="${esc(val('date', c.date))}"></div>
      <div><label>Location</label><input class="in" data-set="location" value="${esc(val('location', c.location))}"></div></div>
    <div class="grid g2" style="margin-top:10px">
      <div><label>Show series (points)</label><select class="in" data-set="seriesId"><option value="">Not part of a series</option>${Object.entries(S.series).map(([id, r]) => `<option value="${esc(id)}"${id===val('seriesId', c.seriesId)?' selected':''}>${esc(r.name)} ${esc(r.year||'')}</option>`).join('')}</select>${!Object.keys(S.series).length ? `<div class="muted small" style="margin-top:4px">Create a series on the <a href="#series">Series</a> page first.</div>` : ''}</div>
      <div><label>Show managers</label><div>${mgrs.map(id => `<span class="mgr">${esc(id===S.uid ? 'You' : nameOf(id))}${mgrs.length>1 ? `<button data-act="rmMgr" data-id="${esc(id)}" title="Remove">✕</button>` : ''}</span>`).join('') || '<span class="muted small">No managers set</span>'}</div>
        <input class="in" id="mgrSearch" placeholder="Add a manager by name" autocomplete="off" style="margin-top:6px"><div id="mgrHits">${mgrHitsHTML()}</div>
        <div class="muted small" style="margin-top:4px">Anyone with an account can be added as a co-manager of this show.</div></div></div>
    <h3 style="margin-top:16px">Species &amp; divisions offered</h3><div class="grid g2">`;
  for(const d of DIVS){
    const on = val('div.'+d.key+'.on', c.divs[d.key].on);
    h += `<div class="exh" style="margin:0"><label class="check"><input type="checkbox" data-set="div.${d.key}.on"${on?' checked':''}> ${esc(d.label)}</label>`;
    if(on){
      h += `<label style="margin-top:8px">Breeds, in show order (one per line)</label><textarea class="in" data-set="div.${d.key}.breeds" style="min-height:90px">${esc(val('div.'+d.key+'.breeds', c.divs[d.key].breeds.join('\n')))}</textarea>
        <div class="muted small" style="margin-top:4px">${d.market ? 'Classes split by weight' : 'Classes split by birth date'}${d.sexes.length > 1 ? ` · sexes: ${esc(d.sexes.join(', '))}` : ''}</div>`;
      if(d.sexes.length > 1) h += `<label class="check small" style="margin-top:6px"><input type="checkbox" data-set="div.${d.key}.combine"${val('div.'+d.key+'.combine', c.divs[d.key].combine)?' checked':''}> Show ${esc(d.sexes.join(' & ').toLowerCase())} together</label>`;
      if(d.key === 'bbeef') h += `<label class="check small" style="margin-top:6px"><input type="checkbox" data-set="div.${d.key}.byMonth"${val('div.'+d.key+'.byMonth', c.divs[d.key].byMonth)?' checked':''}> Heifers: one class for each birth month in a breed</label>`;
    }
    h += `</div>`;
  }
  h += `</div><h3 style="margin-top:16px">Showmanship</h3><div class="grid g2">${SP_ORDER.map(sp => { const on = val('sm.'+sp, c.sm[sp]); return `<div class="exh" style="margin:0;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><label class="check" style="flex:1"><input type="checkbox" data-set="sm.${sp}"${on?' checked':''}> ${esc(SPECIES[sp].sm)}</label>${on ? `<select class="in" style="width:auto" data-set="smPos.${sp}"><option value="first"${val('smPos.'+sp, c.smPos[sp])!=='last'?' selected':''}>Before ${esc(SPECIES[sp].label.toLowerCase())} classes</option><option value="last"${val('smPos.'+sp, c.smPos[sp])==='last'?' selected':''}>After ${esc(SPECIES[sp].label.toLowerCase())} classes</option></select>` : ''}</div>`; }).join('')}</div>
    <div class="grid g3" style="margin-top:10px">
      <div><label>Showmanship age divisions (name, min, max)</label><textarea class="in" data-set="divisions">${esc(val('divisions', c.divisions.map(d=>`${ageName(d.name)}, ${d.min}, ${d.max}`).join('\n')))}</textarea></div>
      <div class="grid" style="align-content:start"><div><label>Max head per class</label><input class="in" type="number" min="1" data-set="maxPerClass" value="${esc(val('maxPerClass', c.maxPerClass))}"></div>
        <div><label>First back number</label><input class="in" type="number" min="1" data-set="startBack" value="${esc(val('startBack', c.startBack))}"></div></div>
      <div class="grid" style="align-content:start"><div><label>Minutes per head</label><input class="in" type="number" min="0.5" step="0.5" data-set="minPerHead" value="${esc(val('minPerHead', c.minPerHead))}"></div>
        <div><label>Minutes per drive</label><input class="in" type="number" min="1" data-set="driveMin" value="${esc(val('driveMin', c.driveMin))}"></div></div></div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px">
      <label class="check"><input type="checkbox" data-set="entriesOpen"${val('entriesOpen', c.entriesOpen)?' checked':''}> Entries open</label>
      <label class="check"><input type="checkbox" data-set="drives"${val('drives', c.drives)?' checked':''}> Champion drives when a breed is split</label>
      <label class="check"><input type="checkbox" data-set="ageJan1"${val('ageJan1', c.ageJan1)?' checked':''}> Showmanship age as of Jan 1</label></div>
    <div class="row-actions"><button class="btn danger" data-act="delShow">${S.confirmShowDel?'Tap again to delete this show':'Delete show'}</button><span style="flex:1"></span><button class="btn pri" data-act="saveSettings">Save settings</button></div>`;
  return h;
}
function mgrHitsHTML(){ return S.mgrHits.map(hit => `<button class="tap" style="margin:6px 6px 0 0" data-act="addMgr" data-id="${esc(hit.id)}">+ ${esc(hit.name || 'Someone')}</button>`).join(''); }

function champSelectsHTML(c, g, classesInGroup){
  const cand = [];
  classesInGroup.forEach(x => ((c.results||{})[x.id]||[]).filter(k => x.members.includes(k)).forEach((k, i) => cand.push({k, i, cls:x})));
  cand.sort((a,b) => a.i - b.i);
  if(!cand.length) return `<div class="muted small" style="margin-top:8px">Place the classes in this breed first.</div>`;
  const ch = (c.champs||{})[g] || {};
  const optsH = sel => `<option value="">—</option>` + cand.filter(o => o.i < 2).map(o => { const m = memberLabel(o.k); return `<option value="${esc(o.k)}"${o.k===sel?' selected':''}>#${esc(m.back)} ${esc(m.main)} (${ord(o.i+1)}${classesInGroup.length>1 ? ', '+esc(o.cls.sub || o.cls.range) : ''})</option>`; }).join('');
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">
    <label style="margin:0">Champion <select class="in" style="width:auto" data-champ="${esc(g)}" data-role="ch">${optsH(ch.ch)}</select></label>
    <label style="margin:0">Reserve <select class="in" style="width:auto" data-champ="${esc(g)}" data-role="res">${optsH(ch.res)}</select></label></div>`;
}
function classPlaced(c, x){
  if(x.kind === 'drive'){ const ch = (c.champs||{})[groupOf(x)] || {}; return !!ch.ch; }
  return !x.members.length || ((c.results||{})[x.id]||[]).some(k => x.members.includes(k));
}
function placingsHTML(c){
  const order = c.order || [];
  if(!order.length) return '';
  const groups = new Map();
  for(const x of order){ const g = groupOf(x); if(!groups.has(g)) groups.set(g, {classes:[], drive:null}); if(x.kind === 'breed') groups.get(g).classes.push(x); if(x.kind === 'drive') groups.get(g).drive = x; }
  if(S.placeClass === undefined || S.placeClass === null){
    const cur = order.find(x => x.id === c.current) || order.find(x => !classPlaced(c, x));
    S.placeClass = cur ? cur.id : '';
  }
  const doneN = order.filter(x => classPlaced(c, x)).length;
  let h = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Placings by class</h3><span class="muted small">${doneN} of ${order.length} classes placed</span></div>
    <p class="muted small">Open a class and tap entries in placing order. Anyone not tapped counts as not shown, so class size is the number placed.</p>
    <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff">`;
  order.forEach((x, i) => {
    const placed = classPlaced(c, x), open = S.placeClass === x.id, isCur = x.id === c.current;
    h += `<div class="ord ${isCur?'ring':''}" data-act="openPlace" data-id="${esc(x.id)}" style="cursor:pointer"><span class="muted cond" style="min-width:24px">${i+1}</span>
      <div class="body"><div class="t">${esc(x.title)}${x.sub ? ` <span class="muted small">${esc(x.sub)}</span>` : ''}</div><div class="muted small">${subLine(x)}</div></div>
      <span class="chip ${placed ? 'done' : (isCur ? 'ring' : '')}">${placed ? '✓ Placed' : (isCur ? 'In the ring' : 'Not placed')}</span></div>`;
    if(!open) return;
    h += `<div style="padding:10px 12px 14px;background:#fbf7ee;border-bottom:1px solid var(--line)">`;
    if(x.kind === 'drive'){
      h += `<div class="small muted">Champion drive: pick from the top two of each class.</div>` + champSelectsHTML(c, groupOf(x), (groups.get(groupOf(x))||{classes:[]}).classes);
    } else if(!x.members.length){
      h += `<div class="muted small">No entries in this class.</div>`;
    } else {
      if(!S.placeDraft[x.id]) S.placeDraft[x.id] = [...(((c.results||{})[x.id]) || [])].filter(k => x.members.includes(k));
      const draft = S.placeDraft[x.id], saved = JSON.stringify(((c.results||{})[x.id] || []).filter(k => x.members.includes(k))) === JSON.stringify(draft);
      h += `<div style="border:1px solid var(--line);border-radius:10px;overflow:hidden">${draft.length ? draft.map((k, j) => { const m = memberLabel(k); return `<div class="placed"><span class="pl">${ord(j+1)}</span><span class="back">${esc(m.back)}</span><div style="flex:1"><b>${esc(m.main)}</b> <span class="muted small">${esc(m.sub)}</span></div><button class="ib" data-act="unplace" data-k="${esc(k)}">✕</button></div>`; }).join('') : '<div class="placed muted small">Tap entries below in placing order.</div>'}</div>
        <div class="taps">${x.members.filter(k => !draft.includes(k)).map(k => { const m = memberLabel(k); return `<button class="tap" data-act="place" data-k="${esc(k)}"><b>${esc(m.back)}</b>${esc(m.main)} <span class="muted small">${esc(x.kind==='sm' ? '' : m.sub.split(' · ')[0])}</span></button>`; }).join('')}</div>
        <div class="row-actions"><button class="btn ghost" data-act="clearPlace">Clear</button><span style="flex:1"></span><span class="muted small" style="align-self:center">${saved ? (draft.length ? 'Saved' : '') : 'Not saved'}</span><button class="btn pri" data-act="savePlace"${saved?' disabled':''}>Save placings</button></div>`;
      const grp = groups.get(groupOf(x));
      if(x.kind === 'breed' && grp && !grp.drive && grp.classes.length === 1 && saved && draft.length)
        h += `<div class="small" style="margin-top:12px"><b>Breed champion</b> <span class="muted">(only class in this breed)</span></div>` + champSelectsHTML(c, groupOf(x), grp.classes);
    }
    h += `</div>`;
  });
  h += `</div>`;
  /* breeds split into classes but no drive in the order: pick champions here */
  const noDrive = [...groups.entries()].filter(([, g]) => g.classes.length > 1 && !g.drive && g.classes.some(x => classPlaced(c, x)));
  if(noDrive.length){
    h += `<h3 style="margin-top:18px">Breed champions</h3>`;
    for(const [g, info] of noDrive) h += `<div class="exh"><b>${esc(info.classes[0].title)}</b>${champSelectsHTML(c, g, info.classes)}</div>`;
  }
  /* overall drives per division + sex */
  const R = rulesFor(S.showId), slots = (R.overall||[]).length, L = S.lookup;
  if(slots){
    const ovs = new Map();
    for(const [g, info] of groups){
      if(!info.classes.length) continue;
      const meta = groupMeta(info.classes[0], L, c); if(!meta.div) continue;
      const ch = (c.champs||{})[g] || {}, ok = `${meta.div}|${meta.sex}`;
      if(!ovs.has(ok)) ovs.set(ok, {label: meta.sex === 'all' ? DIV[meta.div].label : `${DIV[meta.div].label} – ${sexTitle(DIV[meta.div], meta.sex)}`, cand:[]});
      [ch.ch, ch.res].filter(Boolean).forEach(k => ovs.get(ok).cand.push(k));
    }
    const live = [...ovs.entries()].filter(([, o]) => o.cand.length > 1);
    if(live.length){
      h += `<h3 style="margin-top:18px">Overall drives</h3><p class="muted small" style="margin-top:0">Pick from the breed champions and reserves. Bonus: ${esc((R.overall||[]).join(', '))}.</p>`;
      for(const [ok, o] of live){
        const cur = (c.overall||{})[ok] || [];
        h += `<div class="exh"><b>${esc(o.label)}</b><div class="grid g3" style="margin-top:6px">${Array.from({length: Math.min(slots, o.cand.length)}, (_, i) => `<div><label>${i===0 ? 'Supreme / Grand' : i===1 ? 'Reserve' : ord(i+1)}</label><select class="in" data-ovr="${esc(ok)}" data-i="${i}"><option value="">—</option>${o.cand.map(k => { const m = memberLabel(k); return `<option value="${esc(k)}"${cur[i]===k?' selected':''}>#${esc(m.back)} ${esc(m.main)}</option>`; }).join('')}</select></div>`).join('')}</div></div>`;
      }
    }
  }
  return h + `</div>`;
}
function viewOffice(){
  if(!isManager()) return `<div class="card empty"><h3>Show managers only</h3><p class="muted">This area is for the show’s managers.</p></div>`;
  if(!S.showsLoaded || !S.entriesLoaded) return loading();
  if(!S.shows[S.showId]) return notFound();
  const c = cfg(), info = ringInfo();
  let h = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Show settings</h3><button class="btn sm ghost" data-act="toggleSettings">${S.showSettings?'Hide':'Edit'}</button></div>`;
  h += S.showSettings ? settingsHTML(c) : `<div class="muted small" style="margin-top:6px">${esc(speciesLine(c))} · max ${esc(c.maxPerClass)} per class · ${c.seriesId && S.series[c.seriesId] ? esc(S.series[c.seriesId].name) + ' · ' : ''}entries ${c.entriesOpen?'<b style="color:var(--green)">open</b>':'<b style="color:var(--rust)">closed</b>'}</div>
      <div class="row-actions"><button class="btn sm" data-act="toggleEntries">${c.entriesOpen?'Close entries':'Reopen entries'}</button><span style="flex:1"></span><button class="btn sm danger" data-act="delShow">${S.confirmShowDel?'Tap again to delete this show':'Delete show'}</button></div>`;
  h += `</div>`;
  const animals = activeAnimals(), docs = Object.entries(S.entries).filter(([, d]) => exOf(d).length);
  const exCount = docs.reduce((n, [, d]) => n + exOf(d).length, 0);
  h += `<div class="stats" style="margin-bottom:12px">
    <div class="stat"><b>${exCount}</b><span class="muted small">exhibitors</span></div>
    <div class="stat"><b>${animals.length}</b><span class="muted small">head entered</span></div>
    <div class="stat"><b>${smExhibitors().reduce((n, e) => n + smList(e.ex).filter(sp => c.sm[sp]).length, 0)}</b><span class="muted small">showmanship entries</span></div>
    <div class="stat"><b>${info.list.length}</b><span class="muted small">classes</span></div></div>`;
  const un = unassigned();
  h += `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Show order</h3>
    <span style="display:flex;gap:8px;flex-wrap:wrap">${c.order ? `<button class="btn sm ghost" data-act="unlock">Back to draft</button>` : ''}
    <button class="btn sm ${c.order?'':'pri'}" data-act="buildOrder">${c.order?'Rebuild from entries':'Lock order & assign back numbers'}</button></span></div>`;
  h += c.order ? `<p class="muted small">Locked. Rebuilding keeps back numbers, placings and your class order, and adds new entries. Use ▶ to put a class in the ring.</p>`
               : `<p class="muted small">This is the automatic draft. Lock it when entries close to assign back numbers, reorder classes and record placings.</p>`;
  if(un.length) h += `<div class="banner warn">${un.length} new entr${un.length===1?'y isn’t':'ies aren’t'} in the locked order yet. Tap <b>Rebuild from entries</b>.</div>`;
  h += `<div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff">`;
  info.list.forEach((cls, i) => {
    const st = statusOf(i, info), hasRes = ((c.results||{})[cls.id]||[]).length;
    h += `<div class="ord ${st.k==='ring'?'ring':''} ${st.k==='done'?'done':''}"><span class="muted cond" style="min-width:24px">${i+1}</span>
      <div class="body"><div class="t">${esc(cls.title)}${hasRes ? ' <span class="pill">Placed</span>' : ''}</div><div class="muted small">${subLine(cls)}</div></div>
      ${c.order ? `<button class="ib" title="Move up" data-act="mv" data-i="${i}" data-d="-1"${i===0?' disabled':''}>↑</button>
      <button class="ib" title="Move down" data-act="mv" data-i="${i}" data-d="1"${i===info.list.length-1?' disabled':''}>↓</button>
      <button class="ib" title="Put in the ring" data-act="setCur" data-id="${esc(cls.id)}">▶</button>
      <button class="ib" title="Mark done / not done" data-act="togDone" data-id="${esc(cls.id)}">✓</button>` : ''}</div>`;
  });
  if(!info.list.length) h += `<div class="ord muted">No classes yet.</div>`;
  h += `</div></div>`;
  if(c.order) h += placingsHTML(c);
  h += `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Entries</h3><button class="btn sm pri" data-act="newOffice">+ Add paper entry</button></div>`;
  if(S.editing) h += `<div style="margin-top:12px">${editorHTML(S.editing)}</div>`;
  if(!docs.length) h += `<p class="muted">No entries yet. Families enter from their barn on the Enter tab, or add paper entries here.</p>`;
  else {
    h += `<div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>Exhibitor</th><th>Animals</th><th>Showmanship</th><th></th></tr></thead><tbody>`;
    docs.sort((a,b) => (exOf(a[1])[0]?.name||'').localeCompare(exOf(b[1])[0]?.name||''));
    for(const [docId, d] of docs) exOf(d).forEach((ex, idx) => {
      const animalsH = (ex.animals||[]).map(a => { const dv = animalDiv(a, c); return `<div${a.scratched?' style="text-decoration:line-through;opacity:.55"':''}><span class="back" style="font-size:.8rem;min-width:36px;display:inline-block">${esc(backOf(docId+'|'+a.id))}</span> ${esc(a.name||'Unnamed')} <span class="muted small">${esc(a.breed)} ${esc(a.sex)}${dv ? ' · '+esc(DIV[dv].label) : ' · <span class="warn-t">no division</span>'}${a.weight && dv && DIV[dv].market ?' · '+esc(a.weight)+' lb':''}</span></div>`; }).join('');
      h += `<tr><td><b>${esc(ex.name||'—')}</b><br><span class="muted small">${ex.age?'age '+esc(ex.age):''}${ex.town?' · '+esc(ex.town):''}${docId.startsWith('office-')?' · paper entry':''}</span></td>
        <td>${animalsH || '<span class="muted">—</span>'}</td><td class="small">${smList(ex).map(sp => esc(SPECIES[sp].label)).join(', ')}</td>
        <td>${idx===0?`<button class="btn sm ghost" data-act="edit" data-doc="${esc(docId)}">Edit</button>`:''}</td></tr>`;
    });
    h += `</tbody></table></div>`;
  }
  return h + `</div>`;
}

/* ================= render ================= */
function isTyping(){
  const a = document.activeElement;
  return a && $('#app').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !['search','resFilter','mgrSearch','showSearch','userQ'].includes(a.id) && a.type !== 'checkbox';
}
function render(force){
  if(!force && isTyping()){ S.pending = true; return; }
  S.pending = false;
  if(!sb){ $('#app').innerHTML = setupHTML(); return; }
  if(S.view === 'welcome' && S.authReady && S.uid){ S.view = 'shows'; history.replaceState(null, '', '#shows'); }
  rebuildLookup();
  const inShow = ['live','results','enter','office'].includes(S.view) && S.showId;
  const c = cfg(), show = S.shows[S.showId];
  $('#showName').textContent = inShow && show ? c.name : 'ShowSchedule';
  $('#showMeta').textContent = inShow && show ? [longDate(c.date), c.location].filter(Boolean).join(' · ') : '';
  let nav = [['shows','All shows'],['series','Series'],['barn','My barn'], ...(S.isOwner ? [['users','Users']] : [])].map(([k,l]) => `<a href="#${k}" class="${S.view===k || (k==='series' && S.view==='seriesOne')?'on':''}">${l}</a>`).join('');
  if(inShow){
    const t = [['live','Live'],['results','Results'],['enter','Enter']]; if(isManager()) t.push(['office','Show office']);
    nav += `<span style="width:1px;background:#4a4136;margin:6px 6px"></span>` + t.map(([k,l]) => `<a href="#${k}-${esc(S.showId)}" class="${S.view===k?'on':''}">${l}</a>`).join('');
  }
  $('#tabs').innerHTML = S.view === 'welcome' ? '' : nav;
  document.body.classList.toggle('on-welcome', S.view === 'welcome');
  const fid = document.activeElement && ['search','resFilter','mgrSearch','showSearch','userQ'].includes(document.activeElement.id) ? document.activeElement.id : null;
  const pos = fid ? document.activeElement.selectionStart : null;
  const ac = $('#acct');
  if(S.uid && !S.noDb){ const n = S.myName || 'Account'; ac.className = 'acct'; ac.innerHTML = `<span class="av">${esc(n.trim()[0]||'?').toUpperCase()}</span>${esc(n.split(' ')[0])}`; }
  else { ac.className = 'acct out'; ac.textContent = 'Log in'; }
  if(S.loadErr && !S.showsLoaded && !['welcome','account','barn'].includes(S.view)){ $('#app').innerHTML = loadErrHTML(); renderRingbar(); return; }
  const V = {welcome:viewWelcome, users:viewUsers, account:viewAccount, shows:viewShows, barn:viewBarn, live:viewLive, results:viewResults, enter:viewEnter, office:viewOffice, series:viewSeriesList, seriesOne:viewSeries}[S.view] || viewShows;
  $('#app').innerHTML = V();
  if(fid && document.getElementById(fid)){ const s = document.getElementById(fid); s.focus(); try{ s.setSelectionRange(pos, pos); }catch(e){} }
  renderRingbar();
}
function renderRingbar(){
  const bar = $('#ringbar');
  if(!isManager() || S.view !== 'live' || !S.shows[S.showId]){ bar.innerHTML = ''; return; }
  const {c, list, ci} = ringInfo();
  if(!c.order){ bar.innerHTML = `<div class="ringbar"><div class="wrap"><div class="info">Ring control<b>Lock the show order to start running classes</b></div><button class="btn pri" data-act="buildOrder">Lock order</button></div></div>`; return; }
  const cur = list[ci];
  bar.innerHTML = `<div class="ringbar"><div class="wrap">
    <button class="btn" data-act="prev"${ci<0?' disabled':''}>◀</button>
    <div class="info">${cur ? 'In the ring' : 'Ring control'}<b>${cur ? esc(cur.title + (cur.sub ? ' · '+cur.sub : '')) : (list.length ? 'Ready to start' : 'No classes')}</b></div>
    ${cur ? `<a class="btn" href="#office-${esc(S.showId)}" data-act="goPlace" data-id="${esc(cur.id)}" style="text-decoration:none">Place</a>` : ''}
    <button class="btn grn" data-act="next"${!list.length?' disabled':''}>${ci<0 ? 'Start show' : (S.confirmDel === 'skip|'+(cur&&cur.id) ? 'Skip ▶' : (ci >= list.length-1 ? 'Finish' : 'Next ▶'))}</button></div></div>`;
}

/* ================= actions ================= */
function setPath(obj, path, v){ const p = path.split('.'); let o = obj; for(let i=0;i<p.length-1;i++) o = o[p[i]]; o[p[p.length-1]] = v; }
function parseSettings(){
  const c = cfg(), d = S.setDraft, out = {};
  const lines = s => String(s).split('\n').map(x=>x.trim()).filter(Boolean);
  if(d.name !== undefined) out.name = d.name.trim() || 'New show';
  if(d.date !== undefined) out.date = d.date;
  if(d.location !== undefined) out.location = d.location.trim();
  if(d.seriesId !== undefined) out.seriesId = d.seriesId;
  if(d.divisions !== undefined) out.divisions = lines(d.divisions).map(l => { const [n,a,b] = l.split(',').map(x=>x.trim()); return {name:n, min:num(a), max:num(b)||99}; }).filter(x=>x.name);
  for(const k of ['maxPerClass','startBack','minPerHead','driveMin']) if(d[k] !== undefined) out[k] = Math.max(k==='minPerHead'?0.5:1, num(d[k]) || c[k]);
  for(const k of ['entriesOpen','drives','ageJan1']) if(d[k] !== undefined) out[k] = !!d[k];
  const divs = clone(c.divs); let dt = false;
  for(const dv of DIVS){
    for(const f of ['on','breeds','combine','byMonth']){
      const v = d[`div.${dv.key}.${f}`]; if(v === undefined) continue; dt = true;
      divs[dv.key][f] = f === 'breeds' ? lines(v) : !!v;
    }
  }
  if(dt || !(S.shows[S.showId] || {}).divs) out.divs = divs;
  const sm = Object.assign({}, c.sm); let st = false;
  for(const sp of SP_ORDER){ const v = d['sm.'+sp]; if(v !== undefined){ sm[sp] = !!v; st = true; } }
  const smPos = Object.assign({}, c.smPos); let pt = false;
  for(const sp of SP_ORDER){ const v = d['smPos.'+sp]; if(v !== undefined){ smPos[sp] = v; pt = true; } }
  if(pt || !(S.shows[S.showId] || {}).smPos) out.smPos = smPos;
  if(st || !(S.shows[S.showId] || {}).divs) out.sm = sm;
  return out;
}
function buildOrder(){
  const c = cfg(), auto = buildAuto(), backs = Object.assign({}, c.backs||{});
  let next = Math.max(c.startBack - 1, ...Object.values(backs).map(Number).filter(n=>!isNaN(n))) + 1;
  if(c.order){ const pos = new Map(c.order.map((x,i)=>[x.id,i])); auto.sort((a,b) => (pos.has(a.id)?pos.get(a.id):1e6) - (pos.has(b.id)?pos.get(b.id):1e6)); }
  auto.forEach(cls => { if(cls.kind==='breed') cls.members.forEach(k => { if(backs[k]==null) backs[k] = next++; }); });
  const ids = new Set(auto.map(x=>x.id));
  return saveState({order:auto, backs, done:(c.done||[]).filter(id=>ids.has(id)), current: ids.has(c.current) ? c.current : null})
    .then(()=>toast(c.order ? 'Show order rebuilt' : 'Order locked · back numbers assigned'));
}
function deleteShow(id){
  const name = (S.shows[id] && S.shows[id].name) || 'Show';
  return enqueue(async () => {
    const {error} = await sb.from('shows').delete().eq('id', id);   // entries go with it
    if(error) throw error;
    delete S.shows[id];
    for(const k of [...S.entryRows.keys()]) if(k.startsWith(id+'::')) S.entryRows.delete(k);
    rebuildEntries(); toast(`${name} deleted`); render();
  });
}
function writeEntry(docId, exhibitors, ownerId){
  const sid = S.showId, k = sid+'::'+docId, prev = S.entryRows.get(k);
  return enqueue(async () => {
    if(exhibitors.length){
      const row = {show_id:sid, doc_id:docId, owner: prev ? prev.owner : (docId === S.uid ? S.uid : null), exhibitors, updated_at: new Date().toISOString()};
      const {error} = await sb.from('entries').upsert(row);
      if(error) throw error;
      S.entryRows.set(k, row);
    } else {
      const {error} = await sb.from('entries').delete().eq('show_id', sid).eq('doc_id', docId);
      if(error) throw error;
      S.entryRows.delete(k);
    }
    rebuildEntries();
  });
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if(!el) return;
  const a = el.dataset.act, docId = el.dataset.doc;
  const {c, list, ci} = ringInfo();
  switch(a){
    case 'toggle': { const id = el.dataset.id; S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id); render(true); break; }
    case 'jump': { const i = list.findIndex(x => x.id === el.dataset.id); S.expanded.add(el.dataset.id); render(true); const t = $('#c-'+i); if(t) t.scrollIntoView({behavior:'smooth', block:'center'}); break; }
    case 'goPlace': S.placeClass = el.dataset.id; break;
    case 'openPlace': if(e.target.closest('.ib,.tap,select,button:not([data-act=openPlace])')) return; S.placeClass = S.placeClass === el.dataset.id ? '' : el.dataset.id; render(true); break;
    /* shows */
    case 'newShow': {
      const id = 's'+rid();
      const data = Object.assign(clone(DEFAULT_CFG), {createdAt: Date.now()}); delete data.managers;
      enqueue(async () => { const {error} = await sb.from('shows').insert({id, data, managers:[S.uid]}); if(error) throw error; S.shows[id] = Object.assign({}, data, {managers:[S.uid]}); S.openSettingsFor = id; location.hash = 'office-'+id; });
      break; }
    case 'delShow':
      if(!S.confirmShowDel){ S.confirmShowDel = true; render(true); return; }
      S.confirmShowDel = false; deleteShow(S.showId).then(() => { location.hash = 'shows'; });
      break;
    case 'delShowId':
      if(S.confirmDel !== 'show|'+el.dataset.id){ S.confirmDel = 'show|'+el.dataset.id; const l = $('#showList'); if(l) l.innerHTML = showListHTML(); return; }
      S.confirmDel = null; deleteShow(el.dataset.id);
      break;
    case 'retryLoad': S.loadTries = 0; loadAll(); break;
    case 'authTab': S.authTab = el.dataset.k; S.authMsg = ''; S.authErr = ''; render(true); break;
    case 'logout': sb.auth.signOut().then(() => { toast('Logged out'); location.hash = 'welcome'; }); break;
    case 'showWhen': S.showWhen = el.dataset.k; render(true); break;
    case 'addMgr': { const m = [...new Set([...(c.managers||[]), el.dataset.id])]; S.mgrHits = []; saveState({managers:m}).then(()=>toast('Manager added')); break; }
    case 'rmMgr': saveState({managers:(c.managers||[]).filter(x => x !== el.dataset.id)}); break;
    /* series */
    case 'newSeries': {
      const id = 'r'+rid();
      const row = {id, name:'New series', year:String(new Date().getFullYear()), rules:clone(DEFAULT_RULES)};
      enqueue(async () => { const {error} = await sb.from('series').insert(row); if(error) throw error; S.series[id] = {name:row.name, year:row.year, rules:row.rules, createdBy:S.uid}; S.serEdit = true; S.serDraft = null; location.hash = 'series-'+id; });
      break; }
    case 'toggleSerEdit': S.serEdit = !S.serEdit; S.serDraft = null; S.confirmDel = null; render(true); break;
    case 'serCat': S.serCat = el.dataset.k; S.serBreed = ''; render(true); break;
    case 'saveSeries': {
      const d = S.serDraft, R = Object.assign({}, d.rules);
      const nums = v => Array.isArray(v) ? v.map(num) : String(v).split(/[,\s]+/).filter(Boolean).map(num);
      R.table = nums(R.table); R.overall = nums(R.overall);
      for(const k of ['champBonus','resBonus','minShows','bestN']) R[k] = num(R[k]);
      R.champTop = !!R.champTop;
      const id = S.seriesId;
      const upd = {name:(d.name||'').trim()||'Series', year:d.year, rules:R, updated_at:new Date().toISOString()};
      enqueue(async () => { const {error} = await sb.from('series').update(upd).eq('id', id); if(error) throw error; S.series[id] = Object.assign({}, S.series[id], {name:upd.name, year:upd.year, rules:R}); S.serEdit = false; S.serDraft = null; toast('Series saved'); render(true); });
      break; }
    case 'delSeries':
      if(S.confirmDel !== 'series'){ S.confirmDel = 'series'; render(true); return; }
      enqueue(async () => { const {error} = await sb.from('series').delete().eq('id', S.seriesId); if(error) throw error; delete S.series[S.seriesId]; S.confirmDel = null; location.hash = 'series'; toast('Series deleted'); });
      break;
    /* barn */
    case 'addSm': { getBarnDraft().showmen.push({id:'e'+rid(), first:'', last:'', birthdate:'', town:''}); S.barnDirty = true; render(true); const f = document.querySelectorAll('[data-b$=".first"]'); if(f.length) f[f.length-1].focus(); break; }
    case 'rmSm': { const d = getBarnDraft(), sm = d.showmen[+el.dataset.i]; d.showmen.splice(+el.dataset.i, 1); d.animals.forEach(an => { if(an.showmanId === sm.id) an.showmanId = ''; }); S.barnDirty = true; render(true); break; }
    case 'addBa': {
      const d = getBarnDraft(), last = d.animals[d.animals.length-1];
      const showmanId = S.barnSm && S.barnSm !== 'none' ? S.barnSm : (d.showmen.length === 1 ? d.showmen[0].id : '');
      d.animals.push({id:'a'+rid(), species: S.barnSp || (last ? (last.species||'cattle') : 'cattle'), name:'', tag:'', breed:'', sex:'', birthdate:'', weight:'', showmanId});
      S.barnDirty = true; render(true);
      const inputs = document.querySelectorAll('[data-b$=".name"]'); if(inputs.length) inputs[inputs.length-1].focus();
      break; }
    case 'barnSmAnimals': S.barnSm = el.dataset.id; S.barnSp = ''; location.hash = 'barn-animals'; break;
    case 'barnClear': S.barnSm = ''; S.barnSp = ''; render(true); break;
    case 'rmBa': getBarnDraft().animals.splice(+el.dataset.i, 1); S.barnDirty = true; render(true); break;
    case 'saveBarn': {
      const d = getBarnDraft();
      for(const sm of d.showmen){ sm.first = (sm.first||'').trim(); sm.last = (sm.last||'').trim(); sm.town = (sm.town||'').trim(); if(!sm.first){ toast('Each showman needs a first name.', true); if(S.barnTab !== 'showmen') location.hash = 'barn-showmen'; return; } }
      for(const an of d.animals){ an.species = an.species || 'cattle'; if(!an.name || !an.breed || !an.sex){ toast('Each animal needs a name, breed and sex.', true); S.barnSm = ''; S.barnSp = ''; if(S.barnTab !== 'animals') location.hash = 'barn-animals'; else render(true); return; } if(!an.showmanId || !d.showmen.some(x => x.id === an.showmanId)){ toast(`Choose who shows ${an.name}.`, true); S.barnSm = 'none'; S.barnSp = ''; if(S.barnTab !== 'animals') location.hash = 'barn-animals'; else render(true); return; } }
      const data = {showmen:d.showmen, animals:d.animals};
      enqueue(async () => { const {error} = await sb.from('barns').upsert({owner:S.uid, data, updated_at:new Date().toISOString()}); if(error) throw error; S.barn = data; S.barnDirty = false; S.barnDraft = null; toast('Barn saved'); render(true); });
      break; }
    /* enter */
    case 'saveEnter': {
      const d = getEnterDraft(), barn = S.barn || {showmen:[], animals:[]};
      const prior = new Map(); exOf(S.entries[S.uid]).forEach(ex => (ex.animals||[]).forEach(an => prior.set(an.id, an)));
      const exs = [];
      for(const sm of barn.showmen){
        const anims = (barn.animals||[]).filter(an => an.showmanId === sm.id && d.an[an.id]).map(an => {
          const sp = an.species || 'cattle', cands = divCandidates(sp, an.sex, c);
          return {an, sp, div: cands.includes(d.div[an.id]) ? d.div[an.id] : cands[0]};
        }).filter(x => x.div);
        const sms = SP_ORDER.filter(sp => c.sm[sp] && (d.sm[sm.id]||{})[sp]);
        if(!anims.length && !sms.length) continue;
        const age = ageFor(sm, c);
        if(sms.length && !age){ toast(`Add ${sm.first}’s birth date in My barn for showmanship.`, true); return; }
        exs.push({id:sm.id, name:smName(sm), age: age || '', town:sm.town||'', showmanship:sms,
          animals: anims.map(({an, sp, div}) => ({id:an.id, species:sp, div, name:an.name, tag:an.tag||'', breed:an.breed, sex:an.sex, birthdate:an.birthdate||'', weight: String(d.w[an.id] ?? an.weight ?? ''), scratched: !!(prior.get(an.id)||{}).scratched}))});
      }
      if(!exs.length){ toast('Check at least one animal or showmanship.', true); return; }
      writeEntry(S.uid, exs, S.uid).then(() => { delete S.enterDraft[S.showId]; toast('Entries submitted'); render(true); });
      break; }
    case 'withdraw':
      if(S.confirmDel !== 'withdraw'){ S.confirmDel = 'withdraw'; render(true); return; }
      S.confirmDel = null; writeEntry(S.uid, [], S.uid).then(() => { delete S.enterDraft[S.showId]; toast('Withdrawn from this show'); render(true); });
      break;
    /* placings */
    case 'place': S.placeDraft[S.placeClass].push(el.dataset.k); render(true); break;
    case 'unplace': S.placeDraft[S.placeClass] = S.placeDraft[S.placeClass].filter(k => k !== el.dataset.k); render(true); break;
    case 'clearPlace': S.placeDraft[S.placeClass] = []; render(true); break;
    case 'savePlace': { const id = S.placeClass, list2 = [...S.placeDraft[id]]; saveState({results:{[id]: list2}}).then(() => toast('Placings saved')); break; }
    /* office editor */
    case 'addAn': getDraft(docId)[+el.dataset.i].animals.push(newAn()); render(true); break;
    case 'rmAn': getDraft(docId)[+el.dataset.i].animals.splice(+el.dataset.j, 1); render(true); break;
    case 'addEx': getDraft(docId).push(newEx()); render(true); break;
    case 'rmEx': getDraft(docId).splice(+el.dataset.i, 1); render(true); break;
    case 'saveDoc': {
      const clean = getDraft(docId).map(ex => Object.assign({}, ex, {name:(ex.name||'').trim(), animals:(ex.animals||[]).filter(an => an.name || an.breed || an.sex || an.tag).map(an => Object.assign({}, an, {species: DIV[an.div] ? DIV[an.div].species : (an.species||'cattle')}))})).filter(ex => ex.name || ex.animals.length);
      for(const ex of clean){
        if(!ex.name){ toast('Each exhibitor needs a name.', true); return; }
        if(ex.showmanship.length && !num(ex.age)){ toast(`Add ${ex.name}’s age for showmanship.`, true); return; }
        for(const an of ex.animals) if(!an.div || !an.breed || !an.sex){ toast(`Pick a division, breed and sex for each of ${ex.name}’s animals.`, true); return; }
      }
      if(!clean.length){ toast('Add at least one exhibitor.', true); return; }
      writeEntry(docId, clean, docId.startsWith('office-') ? 'office' : docId).then(() => { delete S.drafts[docId]; S.editing = null; toast('Saved'); render(true); });
      break; }
    case 'delDoc':
      if(S.confirmDel !== docId){ S.confirmDel = docId; render(true); return; }
      writeEntry(docId, [], 'office').then(() => { delete S.drafts[docId]; S.editing = null; S.confirmDel = null; toast('Removed from show'); render(true); });
      break;
    case 'edit': S.editing = docId; S.confirmDel = null; delete S.drafts[docId]; render(true); break;
    case 'newOffice': { const id = 'office-'+rid(); S.drafts[id] = [newEx()]; S.editing = id; render(true); break; }
    case 'cancelEdit': delete S.drafts[S.editing]; S.editing = null; render(true); break;
    /* settings & ring */
    case 'toggleSettings': S.showSettings = !S.showSettings; S.confirmShowDel = false; render(true); break;
    case 'saveSettings': saveState(parseSettings()).then(() => { S.setDraft = {}; S.showSettings = false; toast('Settings saved'); render(true); }); break;
    case 'toggleEntries': saveState({entriesOpen: !c.entriesOpen}); break;
    case 'buildOrder': buildOrder(); break;
    case 'unlock': saveState({order:null, current:null, done:[]}).then(()=>toast('Back to draft order')); break;
    case 'mv': { const i = +el.dataset.i, j = i + (+el.dataset.d), o = [...c.order]; if(j<0 || j>=o.length) return; [o[i], o[j]] = [o[j], o[i]]; saveState({order: o}); break; }
    case 'setCur': saveState({current: el.dataset.id, done: (c.done||[]).filter(x => x !== el.dataset.id)}); break;
    case 'togDone': { const s = new Set(c.done||[]), id = el.dataset.id; s.has(id) ? s.delete(id) : s.add(id); saveState({done:[...s], current: c.current===id && s.has(id) ? null : c.current}); break; }
    case 'next': {
      if(ci >= 0 && !classPlaced(c, list[ci]) && S.confirmDel !== 'skip|'+list[ci].id){
        S.confirmDel = 'skip|'+list[ci].id; S.placeClass = list[ci].id;
        toast(list[ci].kind === 'drive' ? 'Pick the champion first, or tap Next again to skip.' : 'Place this class first, or tap Next again to skip.', true);
        renderRingbar(); return;
      }
      S.confirmDel = null;
      const done = new Set(c.done||[]); if(ci >= 0) done.add(list[ci].id);
      let n = ci + 1; while(n < list.length && done.has(list[n].id)) n++;
      saveState({current: n < list.length ? list[n].id : null, done:[...done]});
      if(n >= list.length) toast('Show complete');
      break; }
    case 'prev': {
      if(ci < 0) return;
      if(ci === 0){ saveState({current:null}); break; }
      const done = new Set(c.done||[]); done.delete(list[ci-1].id); saveState({current: list[ci-1].id, done:[...done]}); break; }
  }
});
let mgrTimer = null;
document.addEventListener('input', e => {
  const t = e.target, v = t.type === 'checkbox' ? t.checked : t.value;
  if(t.id === 'barnSm'){ S.barnSm = t.value; render(true); return; }
  if(t.id === 'barnSp'){ S.barnSp = t.value; render(true); return; }
  if(t.id === 'userQ'){ S.userQ = t.value; render(true); return; }
  if(t.dataset.roleUser){ const id = t.dataset.roleUser, role = t.value; enqueue(async () => { const {error} = await sb.from('profiles').update({role}).eq('id', id); if(error) throw error; const u = (S.users||[]).find(x => x.id === id); if(u) u.role = role; toast('Role updated'); }); return; }
  if(t.id === 'showSearch'){ S.showQ = t.value; const l = $('#showList'); if(l) l.innerHTML = showListHTML(); return; }
  if(t.id === 'showSeries'){ S.showSer = t.value; const l = $('#showList'); if(l) l.innerHTML = showListHTML(); return; }
  if(t.id === 'showMine'){ S.showMine = t.checked; const l = $('#showList'); if(l) l.innerHTML = showListHTML(); return; }
  if(t.id === 'search'){ S.search = t.value; try{ localStorage.setItem('ss-follow', S.search); }catch(_){} const r = $('#fres'); if(r) r.innerHTML = findResultsHTML(); return; }
  if(t.id === 'resFilter'){ S.resFilter = t.value; const r = $('#scoreTable'); if(r) r.innerHTML = scoreTableHTML(scoreShow(S.showId).filter(x => x.place != null)); return; }
  if(t.id === 'mgrSearch'){
    clearTimeout(mgrTimer); const q = t.value.trim();
    mgrTimer = setTimeout(async () => { try{ const {data} = q ? await sb.from('profiles').select('id,display_name').ilike('display_name', '%'+q.replace(/[%_]/g,'')+'%').limit(6) : {data:[]}; S.mgrHits = (data||[]).map(p => ({id:p.id, name:p.display_name})); }catch(_){ S.mgrHits = []; } const box = $('#mgrHits'); if(box) box.innerHTML = mgrHitsHTML(); }, 250);
    return;
  }
  if(t.id === 'serBreed'){ S.serBreed = t.value; render(true); return; }
  if(t.dataset.champ){
    const g = t.dataset.champ, cur = Object.assign({ch:'', res:''}, (cfg().champs||{})[g] || {});
    cur[t.dataset.role] = t.value;
    if(cur.ch && cur.ch === cur.res){ if(t.dataset.role === 'ch') cur.res = ''; else cur.ch = ''; }
    saveState({champs:{[g]: cur}}); return;
  }
  if(t.dataset.ovr){
    const k = t.dataset.ovr, cur = [...(((cfg().overall||{})[k]) || [])];
    cur[+t.dataset.i] = t.value;
    for(let i = 0; i < cur.length; i++) if(i !== +t.dataset.i && cur[i] === t.value) cur[i] = '';
    while(cur.length && !cur[cur.length-1]) cur.pop();
    saveState({overall:{[k]: cur.map(x => x || '')}}); return;
  }
  if(t.dataset.smsp){ const [i, sp] = t.dataset.smsp.split('.'), ex = getDraft(t.dataset.doc)[+i]; ex.showmanship = v ? [...new Set([...ex.showmanship, sp])] : ex.showmanship.filter(x => x !== sp); return; }
  if(t.dataset.path){ setPath(getDraft(t.dataset.doc), t.dataset.path, v); if(/\.div$/.test(t.dataset.path)) render(true); return; }
  if(t.dataset.set){ S.setDraft[t.dataset.set] = v; if(/^(div\.\w+\.on|sm\.\w+)$/.test(t.dataset.set)) render(true); return; }
  if(t.dataset.sr){ setPath(S.serDraft, t.dataset.sr, v); if(t.dataset.sr === 'rules.mode') render(true); return; }
  if(t.dataset.b){
    setPath(getBarnDraft(), t.dataset.b, v); S.barnDirty = true;
    if(/\.species$/.test(t.dataset.b)){ const i = +t.dataset.b.split('.')[1], an = getBarnDraft().animals[i]; an.breed = ''; an.sex = ''; render(true); }
    return;
  }
  if(t.dataset.e){
    const [k, id, sp] = t.dataset.e.split('.'), d = getEnterDraft();
    if(k === 'sm'){ d.sm[id] = d.sm[id] || {}; d.sm[id][sp] = v; }
    else { d[k][id] = v; if(k === 'div') render(true); }
    return;
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if(t.dataset.b && /(\.first|\.last|\.birthdate)$/.test(t.dataset.b)) setTimeout(() => render(), 0);   // after focus moves, so a click on the next field isn't lost
});
document.addEventListener('focusout', () => setTimeout(() => { if(S.pending && !isTyping()) render(); }, 0));
function route(){
  const h = (location.hash||'').slice(1);
  const m = h.match(/^(live|results|enter|office)-([A-Za-z0-9]+)$/), sm = h.match(/^series-([A-Za-z0-9]+)$/);
  if(m){ if(S.showId !== m[2]){ S.editing = null; S.setDraft = {}; S.showSettings = false; S.expanded = new Set(); S.placeClass = null; S.placeDraft = {}; S.mgrHits = []; } S.view = m[1]; S.showId = m[2]; if(S.openSettingsFor === m[2]){ S.showSettings = true; S.openSettingsFor = null; } }
  else if(sm){ if(S.seriesId !== sm[1]){ S.serDraft = null; S.serCat = 'overall'; S.serBreed = ''; } S.view = 'seriesOne'; S.seriesId = sm[1]; }
  else if(/^barn(-showmen|-animals)?$/.test(h)){ S.view = 'barn'; S.barnTab = h === 'barn-animals' ? 'animals' : 'showmen'; }
  else S.view = ['series','account','users','shows'].includes(h) ? h : 'welcome';
  if(['account','welcome'].includes(S.view) && S.lastHash && !/^(account|welcome)?$/.test(S.lastHash)) S.returnTo = S.lastHash;
  S.lastHash = h;
  if(S.view === 'users') S.users = null;
  S.confirmDel = null; S.confirmShowDel = false;
  render(true); window.scrollTo(0,0);
}
window.addEventListener('hashchange', route);

/* ================= data loading & live updates ================= */
S.entryRows = new Map();
const showFromRow = r => Object.assign({}, r.data || {}, {managers: r.managers || []});
const seriesFromRow = r => ({name:r.name, year:r.year, rules:r.rules || {}, createdBy:r.created_by});
function rebuildEntries(){
  const m = {};
  for(const r of S.entryRows.values()){
    if(!m[r.doc_id]) m[r.doc_id] = {ownerId:r.owner, shows:{}};
    m[r.doc_id].shows[r.show_id] = {exhibitors: r.exhibitors || []};
  }
  S.entries = m;
}
async function fetchAll(table, cols){
  const out = [], page = 1000;
  for(let from = 0; ; from += page){
    const {data, error} = await sb.from(table).select(cols).range(from, from + page - 1);
    if(error) throw error;
    out.push(...data);
    if(data.length < page) return out;
  }
}
let loadTimer = null;
async function loadAll(){
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => { S.slow = true; render(); }, 10000);
  try{
    const [shows, series, entries] = await Promise.all([
      fetchAll('shows', 'id,data,managers'), fetchAll('series', 'id,name,year,rules,created_by'), fetchAll('entries', 'show_id,doc_id,owner,exhibitors')]);
    S.shows = Object.fromEntries(shows.map(r => [r.id, showFromRow(r)]));
    S.series = Object.fromEntries(series.map(r => [r.id, seriesFromRow(r)]));
    S.entryRows = new Map(entries.map(r => [r.show_id+'::'+r.doc_id, r]));
    rebuildEntries();
    S.showsLoaded = S.entriesLoaded = S.seriesLoaded = true; S.slow = false;
    S.loadErr = null; S.loadTries = 0;
  }catch(e){
    console.error(e);
    S.loadErr = e; S.loadTries = (S.loadTries || 0) + 1;
    setTimeout(loadAll, Math.min(30000, 5000 * S.loadTries));
  }finally{ clearTimeout(loadTimer); }
  render();
}
function subscribeLive(){
  sb.channel('showschedule-live')
    .on('postgres_changes', {event:'*', schema:'public', table:'shows'}, p => {
      if(p.eventType === 'DELETE') delete S.shows[p.old.id]; else S.shows[p.new.id] = showFromRow(p.new);
      render();
    })
    .on('postgres_changes', {event:'*', schema:'public', table:'entries'}, p => {
      const r = p.eventType === 'DELETE' ? p.old : p.new, k = r.show_id+'::'+r.doc_id;
      if(p.eventType === 'DELETE') S.entryRows.delete(k); else S.entryRows.set(k, p.new);
      rebuildEntries(); render();
    })
    .on('postgres_changes', {event:'*', schema:'public', table:'series'}, p => {
      if(p.eventType === 'DELETE') delete S.series[p.old.id]; else S.series[p.new.id] = seriesFromRow(p.new);
      render();
    })
    .subscribe(status => { if(status === 'SUBSCRIBED' && S.liveDropped){ S.liveDropped = false; loadAll(); } if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') S.liveDropped = true; });
}

/* ================= login state ================= */
async function loadMe(){
  const {data:{session}} = await sb.auth.getSession();
  const uid = session ? session.user.id : null;
  if(uid !== S.uid){ S.authTab = 'login'; S.authMsg = ''; S.barnDraft = null; S.barnDirty = false; S.enterDraft = {}; S.drafts = {}; S.editing = null; S.users = null; }
  S.uid = uid; S.email = session ? session.user.email : '';
  S.role = ''; S.myName = ''; S.isAdmin = S.isOwner = false; S.canWrite = !!uid;
  S.barn = null; S.barnLoaded = !uid;
  if(uid){
    const [{data:p}, {data:b}] = await Promise.all([
      sb.from('profiles').select('display_name,role').eq('id', uid).maybeSingle(),
      sb.from('barns').select('data').eq('owner', uid).maybeSingle()]);
    S.myName = (p && p.display_name) || S.email.split('@')[0];
    S.role = (p && p.role) || 'exhibitor';
    S.isOwner = S.role === 'admin';
    S.isAdmin = S.role === 'admin' || S.role === 'manager';
    S.barn = b ? b.data : null; S.barnLoaded = true;
  }
  S.authReady = true;
  render();
}

/* ================= forms (login, sign-up, password, name) ================= */
function authHelp(m){
  if(/database error saving new user/i.test(m)) return 'The database isn’t set up yet. The site owner needs to run supabase/schema.sql in the Supabase SQL Editor.';
  if(/rate limit/i.test(m)) return 'Too many sign-up or reset emails were sent in the last hour. Wait a bit and try again (the site owner can raise this limit by adding an email service in Supabase).';
  if(/not authori[sz]ed/i.test(m) && /email/i.test(m)) return 'Supabase’s built-in email only sends to addresses on your Supabase team. Use the email you log in to Supabase with, or add an email service (SMTP) in Supabase.';
  if(/signups? not allowed|signup is disabled/i.test(m)) return 'New sign-ups are turned off. In Supabase: Authentication → Sign In / Providers → turn on “Allow new users to sign up”.';
  if(/already registered|already been registered/i.test(m)) return 'That email already has an account. Use Log in, or Forgot password if you don’t remember it.';
  if(/email not confirmed/i.test(m)) return 'Confirm your email first: open the message we sent and tap the link, then log in.';
  if(/invalid login credentials/i.test(m)) return 'That email and password don’t match an account.';
  if(/invalid api key|no api key|apikey/i.test(m)) return 'The site’s Supabase key isn’t accepted. Check web/config.js against Supabase → Project Settings → API Keys.';
  if(/failed to fetch|network|load failed/i.test(m)) return 'Couldn’t reach the database server. Check your connection; if it keeps happening, the Supabase project may be paused or the URL in web/config.js is wrong.';
  if(/password/i.test(m) && /(short|least|weak|characters)/i.test(m)) return m;
  if(/email/i.test(m) && /invalid/i.test(m)) return 'Supabase didn’t accept that email address. Use a real address you can open.';
  return m;
}
document.addEventListener('submit', async e => {
  const f = e.target; if(!f.dataset || !f.dataset.form) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f)), btn = f.querySelector('button[type=submit]');
  if(btn) btn.disabled = true;
  S.authErr = ''; S.authErrRaw = '';
  try{
    switch(f.dataset.form){
      case 'login': {
        const {error} = await sb.auth.signInWithPassword({email:v.email.trim(), password:v.password});
        if(error) throw error;
        S.authMsg = ''; toast('Logged in'); location.hash = S.returnTo || 'shows'; S.returnTo = null; break; }
      case 'signup': {
        if((v.password||'').length < 8) throw new Error('Use at least 8 characters for your password.');
        const {data, error} = await sb.auth.signUp({email:v.email.trim(), password:v.password, options:{data:{display_name:v.name.trim()}, emailRedirectTo: siteUrl()}});
        if(error) throw error;
        if(!data.session){ S.authMsg = `Almost done: open the email we sent to ${v.email.trim()} and tap the link to confirm, then log in.`; S.authTab = 'login'; render(true); }
        else { toast('Account created'); location.hash = S.returnTo || 'barn'; S.returnTo = null; }
        break; }
      case 'forgot': {
        const {error} = await sb.auth.resetPasswordForEmail(v.email.trim(), {redirectTo: siteUrl()});
        if(error) throw error;
        S.authMsg = 'If that email has an account, a reset link is on its way.'; S.authTab = 'login'; render(true); break; }
      case 'newpw': {
        if((v.password||'').length < 8) throw new Error('Use at least 8 characters for your password.');
        const {error} = await sb.auth.updateUser({password:v.password});
        if(error) throw error;
        S.recovery = false; toast('Password updated'); location.hash = 'shows'; break; }
      case 'name': {
        const name = (v.name||'').trim(); if(!name) throw new Error('Enter a name.');
        const {error} = await sb.from('profiles').update({display_name:name}).eq('id', S.uid);
        if(error) throw error;
        S.myName = name; toast('Name saved'); render(true); break; }
    }
  }catch(err){
    const raw = (err && (err.message || err.error_description)) || String(err);
    if(['login','signup','forgot','newpw'].includes(f.dataset.form)){ S.authErr = authHelp(raw); S.authErrRaw = raw; render(true); }
    else toast(raw, true);
  }
  finally{ if(btn) btn.disabled = false; }
});

function loadErrHTML(){
  const e = S.loadErr || {}, m = String(e.message || e.error_description || e || ''), code = e.code || '';
  let why, fix;
  if(code === '42501' || /permission denied/i.test(m)){ why = 'The database is set up but isn’t letting the website read it.'; fix = 'In Supabase, open SQL Editor, paste the latest <code>supabase/schema.sql</code> from GitHub and click Run. It’s safe to run again.'; }
  else if(code === 'PGRST205' || code === '42P01' || /could not find the table|does not exist|schema cache/i.test(m)){ why = 'The database tables haven’t been created yet.'; fix = 'In Supabase, open SQL Editor, paste all of <code>supabase/schema.sql</code> from GitHub and click Run.'; }
  else if(/invalid api key|no api key|jwt|unauthori[sz]ed|401/i.test(m)){ why = 'The website’s Supabase key isn’t being accepted.'; fix = 'Check that <code>web/config.js</code> has the project’s anon or publishable key from Supabase → Project Settings → API Keys.'; }
  else if(/failed to fetch|network|load failed|err_name|timed? ?out/i.test(m)){ why = 'The website can’t reach the database server.'; fix = 'Check your internet connection. If it keeps happening, open your Supabase dashboard: free projects pause after a week without use and need to be restored.'; }
  else { why = 'The database returned an error.'; fix = 'Send this message to whoever manages the site.'; }
  return `<div class="card"><h3>Can’t load show data</h3><p><b>${why}</b></p><p class="muted">${fix}</p>
    <p class="small muted" style="margin:10px 0 0">Details: ${esc(m || 'unknown error')}${code ? ` (code ${esc(code)})` : ''} · Retrying automatically.</p>
    <div class="row-actions"><button class="btn" data-act="retryLoad">Try again now</button></div></div>`;
}
function setupHTML(){
  return `<div class="card"><h3>Almost ready</h3><p>This site isn’t connected to its database yet.</p>
    <p class="muted">Add your Supabase project URL and anon key to <code>web/config.js</code>, then push. See <code>docs/SETUP.md</code> in the repository.</p></div>`;
}

/* ================= boot ================= */
(async () => {
  window.__ssBooted = true;
  if(!sb){ S.noDb = true; render(true); return; }
  sb.auth.onAuthStateChange((event, session) => {
    if(event === 'PASSWORD_RECOVERY'){ S.recovery = true; location.hash = 'account'; }
    if((session ? session.user.id : null) !== S.uid || event === 'USER_UPDATED') setTimeout(loadMe, 0);
  });
  route();
  await loadMe();
  await loadAll();
  subscribeLive();
  document.addEventListener('visibilitychange', () => { if(!document.hidden) loadAll(); });
})();
