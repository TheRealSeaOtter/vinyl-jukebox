/** Vinyl Jukebox v0.5 backend
 * Bind this script to the Record Collection Database spreadsheet.
 * Script Property required: DISCOGS_TOKEN
 */
const VJ_SHEET = 'Shelf Library';
const VJ_USER_AGENT = 'ChristianOttVinylJukebox/0.5';

function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = validCallback_(p.callback);
  try {
    let payload;
    switch (p.action || 'health') {
      case 'collection': payload = {ok:true, records: collection_(), source:'Shelf Library'}; break;
      case 'art': payload = artwork_(p); break;
      case 'health': payload = {ok:true, service:'Vinyl Jukebox API', version:'0.5', discogsConfigured:!!discogsToken_()}; break;
      default: payload = {ok:false, error:'Unknown action'};
    }
    return output_(payload, callback);
  } catch (err) {
    return output_({ok:false, error:String(err && err.message || err)}, callback);
  }
}

function collection_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(VJ_SHEET);
  if (!sh) throw new Error('Shelf Library tab not found');
  const values = sh.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const h = {}; values[0].forEach((v,i)=>h[v]=i);
  const get = (row,name) => h[name] == null ? '' : row[h[name]];
  const palette = ['#745e37','#6b5b73','#4f6a5b','#4d5963','#76594e','#584a3c','#52656f','#704a4d','#776b58','#58747d','#6e674f','#73544d'];
  return values.slice(1).filter(r=>get(r,'Discogs Instance ID')).map((r,i)=>({
    id:String(get(r,'Discogs Instance ID')), releaseId:String(get(r,'Discogs Release ID')),
    artist:get(r,'Display Artist'), title:get(r,'Title'), year:Number(get(r,'Year'))||0,
    label:get(r,'Label'), catalog:get(r,'Catalog Number'), format:get(r,'Format'),
    discogsUrl:get(r,'Discogs URL'), folder:get(r,'Folder Name'), rating:Number(get(r,'Rating'))||0,
    genre:get(r,'Discogs Field: Genre'), style:get(r,'Discogs Field: Sub-Genre'),
    purchased:get(r,'Discogs Field: Purchased As'), copyDistinctions:get(r,'Discogs Field: Copy Distinctions'),
    mediaCondition:get(r,'Media Condition')||get(r,'Discogs Field: Media Condition'),
    sleeveCondition:get(r,'Sleeve Condition')||get(r,'Discogs Field: Sleeve Condition'),
    notes:get(r,'Personal Notes')||get(r,'Discogs Field: Notes'), color:palette[i%palette.length]
  }));
}

function artwork_(p) {
  const releaseId = String(p.releaseId || '').replace(/\D/g,'');
  if (!releaseId) return {ok:false,error:'Missing Discogs Release ID'};
  const props = PropertiesService.getScriptProperties();
  const key = 'ART_' + releaseId;
  const cached = props.getProperty(key);
  if (cached) {
    const x = JSON.parse(cached); return {ok:true, url:x.url||'', provider:x.provider||'none', cached:true};
  }
  let found = discogsArt_(releaseId);
  if (!found.url) found = musicBrainzArt_(p);
  // Persist successes indefinitely. Cache misses for 24h only so databases can improve later.
  if (found.url) props.setProperty(key, JSON.stringify(found));
  else CacheService.getScriptCache().put(key, JSON.stringify(found), 21600);
  return {ok:true, url:found.url||'', provider:found.provider||'none', cached:false};
}

function discogsArt_(releaseId) {
  const token = discogsToken_();
  if (!token) throw new Error('DISCOGS_TOKEN is not configured in Script Properties');
  const res = UrlFetchApp.fetch('https://api.discogs.com/releases/' + releaseId, {
    muteHttpExceptions:true,
    headers:{'Authorization':'Discogs token=' + token, 'User-Agent':VJ_USER_AGENT, 'Accept':'application/json'}
  });
  if (res.getResponseCode() !== 200) return {url:'',provider:'discogs'};
  const data = JSON.parse(res.getContentText());
  const images = data.images || [];
  const img = images.find(x=>x.type==='primary') || images[0];
  return {url:img ? (img.uri600 || img.uri || img.resource_url || '') : '', provider:'discogs'};
}

function musicBrainzArt_(p) {
  const cacheKey='MBMISS_'+String(p.releaseId||'');
  const c=CacheService.getScriptCache().get(cacheKey); if(c)return {url:'',provider:'none'};
  const lock=LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const props=PropertiesService.getScriptProperties();
    const last=Number(props.getProperty('MB_LAST_MS')||0), wait=1100-(Date.now()-last);
    if(wait>0)Utilities.sleep(wait);
    const q='release:"'+mbEsc_(p.title)+'" AND artist:"'+mbEsc_(p.artist)+'"';
    const url='https://musicbrainz.org/ws/2/release/?query='+encodeURIComponent(q)+'&fmt=json&limit=5';
    const res=UrlFetchApp.fetch(url,{muteHttpExceptions:true,headers:{'User-Agent':VJ_USER_AGENT,'Accept':'application/json'}});
    props.setProperty('MB_LAST_MS',String(Date.now()));
    if(res.getResponseCode()!==200)return {url:'',provider:'musicbrainz'};
    const rows=(JSON.parse(res.getContentText()).releases||[]);
    const best=rows.find(x=>norm_(x.title)===norm_(p.title) && norm_((x['artist-credit']||[]).map(a=>a.name||'').join(' '))===norm_(p.artist));
    if(!best){CacheService.getScriptCache().put(cacheKey,'1',21600);return {url:'',provider:'none'}}
    let art=caa_(best.id,'release');
    if(!art && best['release-group']) art=caa_(best['release-group'].id,'release-group');
    return {url:art||'',provider:art?'cover-art-archive':'none'};
  } finally { lock.releaseLock(); }
}
function caa_(id,kind){
  if(!id)return '';
  const res=UrlFetchApp.fetch('https://coverartarchive.org/'+kind+'/'+id,{muteHttpExceptions:true,followRedirects:true,headers:{'User-Agent':VJ_USER_AGENT,'Accept':'application/json'}});
  if(res.getResponseCode()!==200)return '';
  const imgs=JSON.parse(res.getContentText()).images||[], img=imgs.find(x=>x.front)||imgs[0];
  return img ? ((img.thumbnails||{})['500'] || (img.thumbnails||{})['1200'] || img.image || '') : '';
}
function discogsToken_(){return PropertiesService.getScriptProperties().getProperty('DISCOGS_TOKEN')||''}
function norm_(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function mbEsc_(s){return String(s||'').replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g,'\\$1')}
function validCallback_(s){return /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(String(s||'')) ? String(s) : ''}
function output_(obj,callback){
  const body=callback ? callback+'('+JSON.stringify(obj)+');' : JSON.stringify(obj);
  return ContentService.createTextOutput(body).setMimeType(callback?ContentService.MimeType.JAVASCRIPT:ContentService.MimeType.JSON);
}
