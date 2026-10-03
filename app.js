// v0.4.2. Field names mirror the live Shelf Library sheet.
// Collection data is loaded from records-data.js.

let state=JSON.parse(localStorage.getItem("vj-state-v03")||"null")||{selected:records[0].id,queue:[],plays:[],art:{},filters:{genre:"",style:"",decade:"",folder:""}};
// v0.4.2 artwork migration: Apple/iTunes is no longer an artwork source.
// Clear prior provider mappings once so incorrect Apple matches cannot survive the upgrade.
if(state.artProvider!=="musicbrainz-caa-v1"){
  state.art={};
  state.artProvider="musicbrainz-caa-v1";
}
state.art=state.art||{};
state.artMisses={};
// Keep existing queue/play history from v0.3, but discard IDs no longer present.
const recordIds=new Set(records.map(r=>r.id));
if(!recordIds.has(state.selected))state.selected=records[0].id;
state.queue=(state.queue||[]).filter(id=>recordIds.has(id));
state.plays=(state.plays||[]).filter(p=>recordIds.has(p.id));
const $=id=>document.getElementById(id), rec=id=>records.find(r=>r.id===id), save=()=>localStorage.setItem("vj-state-v03",JSON.stringify(state));
save();
function toast(s){$("toast").textContent=s;setTimeout(()=>$("toast").textContent="",2200)}
function artStyle(r){return state.art[r.id]?`url('${state.art[r.id]}')`:`linear-gradient(145deg,${r.color},#171713)`}
function art(el,r){el.style.background=artStyle(r);el.textContent=state.art[r.id]?"":r.title}

// MusicBrainz asks API clients to stay at roughly one request/second. Keep a single,
// deliberately paced worker; Cover Art Archive requests happen only after a confident match.
const artQueue=[];let artWorkers=0;const MAX_ART_WORKERS=1;
function norm(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[’‘]/g,"'").replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim()}
function coreTitle(s){return norm(s).replace(/\b(deluxe|edition|anniversary|remaster(?:ed)?|reissue|mono|stereo|expanded|bonus|version)\b/g," ").replace(/\s+/g," ").trim()}
function tokens(s){return new Set(norm(s).split(" ").filter(x=>x.length>1&&!['the','a','an'].includes(x)))}
function overlap(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let n=0;A.forEach(x=>B.has(x)&&n++);return n/Math.max(A.size,B.size)}
function escLucene(s){return String(s||"").replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g,"\\$1")}
function mbArtist(x){return (x['artist-credit']||[]).map(a=>a.name||a.artist?.name||'').join(' ')}
function mbYear(x){return Number(String(x.date||x['first-release-date']||'').slice(0,4))||0}
function mbScore(r,x){
  const rt=norm(r.title), xt=norm(x.title), rc=coreTitle(r.title), xc=coreTitle(x.title);
  let score=0;
  if(rt&&rt===xt)score+=48; else if(rc&&rc===xc)score+=42; else score+=Math.round(24*overlap(rc,xc));
  score+=Math.round(34*overlap(r.artist,mbArtist(x)));
  const y=Number(r.year), my=mbYear(x); if(y&&my){const d=Math.abs(y-my);if(d===0)score+=10;else if(d<=1)score+=7;else if(d<=3)score+=3;}
  const cat=norm(r.catalog), labels=(x['label-info']||[]).map(z=>`${z['catalog-number']||''} ${z.label?.name||''}`).join(' ');
  if(cat&&norm(labels).includes(cat))score+=18;
  if(r.label&&labels&&overlap(r.label,labels)>.5)score+=6;
  score+=Math.min(8,Math.round((Number(x.score)||0)/13));
  return score
}
async function mbSearch(r){
  const parts=[`release:\"${escLucene(r.title)}\"`,`artist:\"${escLucene(r.artist)}\"`];
  if(r.catalog)parts.push(`catno:\"${escLucene(r.catalog)}\"`);
  let url=`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(parts.join(' AND '))}&fmt=json&limit=10`;
  let res=await fetch(url,{headers:{Accept:'application/json'}});
  if(!res.ok)throw new Error(`MusicBrainz ${res.status}`);
  let rows=(await res.json()).releases||[];
  // Catalog numbers are powerful but not universally present in MusicBrainz. Retry without
  // catno when the exact-release query is empty, while retaining strict local confidence checks.
  if(!rows.length&&r.catalog){
    const q=`release:\"${escLucene(r.title)}\" AND artist:\"${escLucene(r.artist)}\"`;
    res=await fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&fmt=json&limit=15`,{headers:{Accept:'application/json'}});
    if(res.ok)rows=(await res.json()).releases||[];
  }
  return rows
}
async function caaFront(kind,id){
  if(!id)return null;
  const endpoint=`https://coverartarchive.org/${kind}/${id}`;
  try{
    const res=await fetch(endpoint,{headers:{Accept:'application/json'}});if(!res.ok)return null;
    const data=await res.json();const img=(data.images||[]).find(x=>x.front)||data.images?.[0];
    return img?.thumbnails?.['500']||img?.thumbnails?.['1200']||img?.image||null;
  }catch(e){return null}
}
async function findArtwork(r){
  let rows=[];try{rows=await mbSearch(r)}catch(e){return null}
  const ranked=rows.map(x=>[mbScore(r,x),x]).sort((a,b)=>b[0]-a[0]);
  const best=ranked[0];
  // Require strong title+artist agreement. A blank tile is preferable to a wrong cover.
  if(!best||best[0]<76||overlap(r.artist,mbArtist(best[1]))<0.55||overlap(coreTitle(r.title),coreTitle(best[1].title))<0.72)return null;
  const release=best[1];
  let url=await caaFront('release',release.id);if(url)return url;
  return await caaFront('release-group',release['release-group']?.id)
}
function resolveArt(r){
  if(!r||state.art[r.id]||state.artMisses[r.id])return;
  state.artMisses[r.id]=true;artQueue.push(r);pumpArtQueue()
}
function pumpArtQueue(){
  while(artWorkers<MAX_ART_WORKERS&&artQueue.length){
    const r=artQueue.shift();artWorkers++;
    findArtwork(r).then(url=>{if(url){state.art[r.id]=url;save();renderAll(false)}}).finally(()=>{delete state.artMisses[r.id];artWorkers--;setTimeout(pumpArtQueue,1150)})
  }
}
function resolveVisibleArt(){
  const selected=rec(state.selected);if(selected)resolveArt(selected);
  filteredRecords().slice(0,48).forEach(resolveArt)
}
function playCount(id){return state.plays.filter(p=>p.id===id).length}
function renderHome(){let r=rec(state.selected)||records[0];art($("albumArt"),r);$("albumTitle").textContent=r.title;$("albumArtist").textContent=r.artist;$("albumMeta").textContent=`${r.year||"Year unknown"} • ${r.genre||"Genre untagged"}${r.style?` • ${r.style}`:""}`;let n=playCount(r.id);$("playInfo").textContent=n?`Played ${n} time${n===1?"":"s"}`:"Not played yet";$("queueBadge").textContent=state.queue.length;$("queuePreview").innerHTML=state.queue.length?state.queue.map(id=>{let q=rec(id);return `<div class="queue-card" data-id="${id}"><div class="mini-art" style="background:${artStyle(q)}">${state.art[q.id]?"":q.artist[0]}</div><div class="row-text"><strong>${q.title}</strong><span>${q.artist}</span></div></div>`}).join(""):`<p class="meta">Queue is empty. Pick something good.</p>`;document.querySelectorAll("#queuePreview .queue-card").forEach(x=>x.onclick=()=>{setQueueDrawer(false);select(x.dataset.id)})}
function select(id){state.selected=id;save();renderAll();show("home")}
function setQueueDrawer(open){
  $("queueDrawer").classList.toggle("open",open);
  $("queueScrim").classList.toggle("open",open);
  $("queueDrawer").setAttribute("aria-hidden",String(!open));
  $("queueDrawerToggle").setAttribute("aria-expanded",String(open));
}
$("queueDrawerToggle").onclick=()=>setQueueDrawer(true);
$("queueDrawerClose").onclick=()=>setQueueDrawer(false);
$("queueScrim").onclick=()=>setQueueDrawer(false);
$("openFullQueueBtn").onclick=()=>{setQueueDrawer(false);show("queue")};
function addQueue(id){if(!state.queue.includes(id)){state.queue.push(id);save();renderAll();toast("Added to queue")}else toast("Already in queue")}
$("finishBtn").onclick=()=>{let r=rec(state.selected);state.plays.unshift({id:r.id,at:new Date().toISOString()});state.queue=state.queue.filter(id=>id!==r.id);save();renderAll();toast(`Logged: ${r.artist} — ${r.title}`)};$("queueCurrentBtn").onclick=()=>addQueue(state.selected);$("pickBtn").onclick=()=>openPicker();$("clearQueueBtn").onclick=()=>{state.queue=[];save();renderAll()};
function filteredRecords(){let f=$("search").value.toLowerCase().trim(),x=state.filters;let rows=records.filter(r=>(r.artist+" "+r.title+" "+r.genre+" "+r.style).toLowerCase().includes(f)&&(!x.genre||r.genre===x.genre)&&(!x.style||r.style.includes(x.style))&&(!x.decade||(r.year>0&&Math.floor(r.year/10)*10===+x.decade))&&(!x.folder||r.folder===x.folder));let sort=$("sort").value;rows.sort((a,b)=>sort==="title"?a.title.localeCompare(b.title):sort==="yearDesc"?b.year-a.year:sort==="ratingDesc"?b.rating-a.rating:a.artist.localeCompare(b.artist));return rows}
function renderCollection(){let rows=filteredRecords();$("collectionCount").textContent=`${rows.length} RECORDS`;let active=Object.entries(state.filters).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`);$("activeFilters").textContent=active.length?active.join("  •  "):"";$("collectionGrid").innerHTML=rows.map(r=>`<div class="album-card" data-id="${r.id}"><div class="cover" style="background:${artStyle(r)}">${state.art[r.id]?"":r.title}</div><strong>${r.title}</strong><span>${r.artist}</span></div>`).join("");document.querySelectorAll(".album-card").forEach(x=>x.onclick=()=>openDetail(x.dataset.id))}
$("search").oninput=renderCollection;$("sort").onchange=renderCollection;$("filterBtn").onclick=openFilters;$("randomResultsBtn").onclick=()=>{let pool=filteredRecords();if(pool.length)showRecommendation(pool,"Filtered collection")};
function renderQueue(){$("queueCount").textContent=`${state.queue.length} RECORDS`;$("queueList").innerHTML=state.queue.length?state.queue.map((id,i)=>{let r=rec(id);return `<div class="list-row"><div class="mini-art" style="background:${artStyle(r)}">${i+1}</div><div class="row-text"><strong>${r.title}</strong><span>${r.artist}</span></div><div class="queue-controls"><button data-up="${i}">↑</button><button data-down="${i}">↓</button><button data-play="${id}">PLAY</button><button class="danger" data-remove="${i}">×</button></div></div>`}).join(""):`<p class="meta">Nothing queued yet.</p>`;document.querySelectorAll("[data-play]").forEach(x=>x.onclick=()=>select(x.dataset.play));document.querySelectorAll("[data-remove]").forEach(x=>x.onclick=()=>{state.queue.splice(+x.dataset.remove,1);save();renderAll()});document.querySelectorAll("[data-up]").forEach(x=>x.onclick=()=>moveQueue(+x.dataset.up,-1));document.querySelectorAll("[data-down]").forEach(x=>x.onclick=()=>moveQueue(+x.dataset.down,1))}
function moveQueue(i,d){let j=i+d;if(j<0||j>=state.queue.length)return;[state.queue[i],state.queue[j]]=[state.queue[j],state.queue[i]];save();renderAll()}
function renderStats(){let counts={};state.plays.forEach(p=>{let r=rec(p.id);if(r)counts[r.artist]=(counts[r.artist]||0)+1});$("totalPlays").textContent=state.plays.length;$("uniquePlayed").textContent=new Set(state.plays.map(p=>p.id)).size;$("topArtist").textContent=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—";$("historyList").innerHTML=state.plays.slice(0,8).map(p=>{let r=rec(p.id);return r?`<div class="list-row"><div class="row-text"><strong>${r.artist} — ${r.title}</strong><span>${new Date(p.at).toLocaleString()}</span></div></div>`:""}).join("")||`<p class="meta">No plays logged yet.</p>`}
function modal(html){$("modalBody").innerHTML=html;$("modal").classList.remove("hidden")}function closeModal(){$("modal").classList.add("hidden")}$("modalClose").onclick=closeModal;$("modal").onclick=e=>{if(e.target===$("modal"))closeModal()}
function openDetail(id){let r=rec(id),n=playCount(id);resolveArt(r);modal(`<div class="detail"><div class="detail-cover" style="background:${artStyle(r)}">${state.art[r.id]?"":r.title}</div><div><div class="eyebrow">ALBUM DETAILS</div><h2>${r.title}</h2><p class="artist">${r.artist}</p><p class="meta">${r.year||"Year unknown"} • ${r.label}<br>${r.genre||"Genre untagged"}${r.style?` • ${r.style}`:""}<br>${r.format}<br>${r.folder} • ${r.rating?"★".repeat(r.rating):"Unrated"}<br>${n?`Played ${n} time${n===1?"":"s"}`:"Never played"}</p><div class="modal-actions"><button class="primary" id="detailPlay">PLAY NOW</button><button id="detailQueue">ADD TO QUEUE</button></div></div></div>`);$("detailPlay").onclick=()=>{closeModal();select(id)};$("detailQueue").onclick=()=>{addQueue(id);closeModal()}}
function unique(k){return [...new Set(records.map(r=>r[k]).filter(Boolean))].sort()}
function openFilters(){let genres=unique("genre"),styles=[...new Set(records.flatMap(r=>r.style?r.style.split(/, | \/ /):[]).filter(Boolean))].sort(),decades=[...new Set(records.filter(r=>r.year>0).map(r=>Math.floor(r.year/10)*10))].sort(),folders=unique("folder");modal(`<div class="eyebrow">COLLECTION</div><h2>FILTERS</h2>${filterGroup("genre",genres)}${filterGroup("style",styles)}${filterGroup("decade",decades.map(x=>x+"s"),decades)}${filterGroup("folder",folders)}<div class="modal-actions"><button class="primary" id="applyFilters">APPLY</button><button id="clearFilters">CLEAR ALL</button></div>`);document.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{let k=b.dataset.filter,v=b.dataset.value;state.filters[k]=state.filters[k]===v?"":v;document.querySelectorAll(`[data-filter='${k}']`).forEach(x=>x.classList.toggle("active",state.filters[k]===x.dataset.value))});$("applyFilters").onclick=()=>{save();closeModal();renderCollection()};$("clearFilters").onclick=()=>{state.filters={genre:"",style:"",decade:"",folder:""};save();closeModal();renderCollection()}}
function filterGroup(k,labels,values=labels){return `<h3>${k.toUpperCase()}</h3><div class="chips">${labels.map((x,i)=>`<button class="chip ${state.filters[k]===String(values[i])?"active":""}" data-filter="${k}" data-value="${values[i]}">${x}</button>`).join("")}</div>`}
function secureIndex(n){if(n<=1)return 0;let a=new Uint32Array(1),limit=Math.floor(0x100000000/n)*n;do crypto.getRandomValues(a);while(a[0]>=limit);return a[0]%n}
function securePick(pool){return pool[secureIndex(pool.length)]}
function openPicker(){modal(`<div class="eyebrow">PICK SOMETHING</div><h2>What kind of pick?</h2><div class="choice-grid"><button class="choice" id="surprise">SURPRISE ME<small>Truly random. No recommendation logic.</small></button><button class="choice" id="genrePick">GENRE / STYLE<small>Choose a musical lane.</small></button><button class="choice" id="vibePick">VIBE<small>Prototype mood choices.</small></button><button class="choice" id="deepPick">DIG DEEPER<small>Never played, neglected, or old favorite.</small></button></div>`);$("surprise").onclick=()=>showRecommendation(records,"Surprise Me",true);$("genrePick").onclick=chooseGenre;$("vibePick").onclick=chooseVibe;$("deepPick").onclick=chooseDepth}
function chooseGenre(){let gs=unique("genre");modal(`<div class="eyebrow">GENRE / STYLE</div><h2>Choose a genre</h2><div class="chips">${gs.map(g=>`<button class="chip" data-g="${g}">${g}</button>`).join("")}</div>`);document.querySelectorAll("[data-g]").forEach(b=>b.onclick=()=>chooseDepth(records.filter(r=>r.genre===b.dataset.g),b.dataset.g))}
const vibeMap={"CHILL":["Downtempo","Trip-Hop","Folk"],"ENERGETIC":["Math Rock","Boom Bap"],"HEAD-NOD":["Hip-Hop","Boom Bap","Jazzy"],"BACKGROUND":["Downtempo","Folk Rock"]};
function chooseVibe(){modal(`<div class="eyebrow">VIBE</div><h2>Choose a vibe</h2><div class="chips">${Object.keys(vibeMap).map(v=>`<button class="chip" data-v="${v}">${v}</button>`).join("")}</div><p class="meta">Vibe tags are prototype-only for now; the Sheet does not yet store them.</p>`);document.querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{let terms=vibeMap[b.dataset.v];let pool=records.filter(r=>terms.some(t=>(r.genre+" "+r.style).includes(t)));showRecommendation(pool.length?pool:records,`Vibe: ${b.dataset.v}`)})}
function chooseDepth(base=records,label="Whole collection"){if(!Array.isArray(base))base=records;modal(`<div class="eyebrow">DIG DEEPER</div><h2>Refine the pick</h2><p class="match-count">Starting pool: ${base.length} records • ${label}</p><div class="choice-grid"><button class="choice" data-depth="any">ANYTHING<small>No play-history filter.</small></button><button class="choice" data-depth="lately">HAVEN'T PLAYED LATELY<small>Oldest or never-played records.</small></button><button class="choice" data-depth="never">NEVER PLAYED<small>Only records with zero logged plays.</small></button><button class="choice" data-depth="favorite">OLD FAVORITE<small>Rated 4–5 stars and previously played.</small></button></div>`);document.querySelectorAll("[data-depth]").forEach(b=>b.onclick=()=>{let pool=depthPool(base,b.dataset.depth);showRecommendation(pool.length?pool:base,`${label} • ${b.textContent.trim()}`)})}
function depthPool(base,d){if(d==="never")return base.filter(r=>!playCount(r.id));if(d==="favorite")return base.filter(r=>r.rating>=4&&playCount(r.id));if(d==="lately"){let last={};state.plays.forEach(p=>{if(!last[p.id])last[p.id]=new Date(p.at).getTime()});let played=base.filter(r=>last[r.id]).sort((a,b)=>last[a.id]-last[b.id]);let never=base.filter(r=>!last[r.id]);return never.concat(played.slice(0,Math.max(1,Math.ceil(played.length/2))))}return base}
function showRecommendation(pool,label,isPureRandom=false){if(!pool.length)return;let r=securePick(pool);resolveArt(r);modal(`<div class="recommend-result"><div class="eyebrow">${isPureRandom?"🎲 RANDOM DRAW":"RECOMMENDATION"}</div><div class="recommend-cover" style="background:${artStyle(r)}">${state.art[r.id]?"":r.title}</div><h2>${r.title}</h2><p class="artist">${r.artist}</p><p class="match-count">${label} • ${pool.length} eligible record${pool.length===1?"":"s"}${isPureRandom?` • draw #${pool.indexOf(r)+1} of ${pool.length}`:""}</p><div class="modal-actions" style="justify-content:center"><button class="primary" id="recPlay">PLAY NOW</button><button id="recQueue">ADD TO QUEUE</button><button id="reroll">NAH, TRY AGAIN</button></div></div>`);$("recPlay").onclick=()=>{closeModal();select(r.id)};$("recQueue").onclick=()=>addQueue(r.id);$("reroll").onclick=()=>showRecommendation(pool,label,isPureRandom)}
function renderAll(loadArt=true){renderHome();renderCollection();renderQueue();renderStats();if(loadArt)resolveVisibleArt()}function show(id){document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active",s.id===id));document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.screen===id))}document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>show(b.dataset.screen));function tick(){$("clock").textContent=new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}setInterval(tick,1000);tick();renderAll();if("serviceWorker" in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js");
