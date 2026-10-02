'use strict';
(() => {
  const routes = [
    {line:'TML', station:'TUM', direction:'DOWN', destination:'WKS', from:'屯門', to:'烏溪沙', name:'屯馬綫（西鐵段）'},
    {line:'TKL', station:'TIK', direction:'UP', destination:'POA', from:'調景嶺', to:'寶琳', name:'將軍澳綫', className:'tkl'}
  ];
  const MAX_AGE = 90000;
  const parse = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? Date.parse(value.replace(' ','T')+'+08:00') : NaN;
  function select(data, route, now) {
    const station = data.data?.[`${route.line}-${route.station}`];
    const timestamp = parse(station?.curr_time || data.curr_time);
    if (Number(data.status) !== 1) throw Error('service');
    if (!station || !Number.isFinite(timestamp)) throw Error('invalid');
    if (now-timestamp > MAX_AGE || timestamp-now > 60000) throw Error('stale');
    const trains = station[route.direction] ?? [];
    if (!Array.isArray(trains)) throw Error('invalid');
    return {timestamp, delayed: data.isdelay === 'Y', rows: trains
      .filter(train => train.dest === route.destination)
      .map(train => ({...train, at:parse(train.time)}))
      .filter(train => Number.isFinite(train.at) && train.at >= now)
      .sort((a,b) => a.at-b.at)};
  }
  // Export the data adapter for regression tests without requiring a browser.
  if (typeof module !== 'undefined' && module.exports) {module.exports={select, routes, parse}; return;}
  const make = (tag, cls, value) => {const node=document.createElement(tag); node.className=cls||''; if(value!==undefined)node.textContent=value; return node;};
  const clock = value => new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
  const states = routes.map(route => {
    const section=make('section','rail-section '+(route.className||''));
    section.id='panel-'+route.line.toLowerCase();
    section.hidden=true;
    section.setAttribute('role','tabpanel');
    section.setAttribute('aria-labelledby','tab-'+route.line.toLowerCase());
    section.tabIndex=0;
    section.setAttribute('aria-label',`${route.from}往${route.to}班次`);
    section.innerHTML='<div class="rail-line"></div><h2></h2><div class="hero"><div class="hero-top"><span class="caption"></span><span class="live">連線中</span></div><div class="hero-time"><strong class="words">讀取中</strong><span class="unit"></span></div><div class="hero-bottom"></div></div><div class="rail-status" role="status"></div><div class="section-head"><h3 style="font-size:14px;margin:0">稍後班次</h3><span class="total rail-line"></span></div><div class="later"></div><p class="rail-note"></p><div class="rail-refresh"><div class="refresh-info">更新 —</div><button type="button" class="rail-refresh-button">↻ 更新班次</button></div>';
    const get=selector=>section.querySelector(selector);
    get('.rail-line').textContent=route.name;
    get('h2').textContent=`${route.from} → ${route.to}`;
    get('.caption').textContent=route.station==='TUM'?'下一班從屯門開出':'下一班抵達調景嶺';
    get('.rail-note').textContent=(route.line==='TKL'?'只顯示往寶琳列車，不包括康城。':'顯示屯門站往烏溪沙的列車。')+'港鐵每個方向最多提供未來四班預報；以車站顯示及廣播為準。';
    document.getElementById('railSchedules').append(section);
    const state={route,get,busy:false,result:null};
    get('.rail-refresh-button').addEventListener('click',()=>refresh(state));
    return state;
  });
  function clear(state, title, message) {
    state.result=null;
    state.get('.hero-time strong').textContent=title;
    state.get('.hero-time strong').className='words';
    state.get('.unit').textContent='';
    state.get('.hero-bottom').textContent=message;
    state.get('.later').replaceChildren();
    state.get('.total').textContent='';
    state.get('.live').textContent='等待更新';
  }
  function render(state) {
    const {result,get,route}=state;
    if (!result) return;
    const now=Date.now();
    if (now-result.timestamp>MAX_AGE) {clear(state,'資料已過期','等候最新的班次預報。');return;}
    const rows=result.rows.filter(row=>row.at>=now);
    get('.live').textContent=result.delayed?'服務延誤':'即時預報';
    get('.rail-status').textContent=result.delayed?'港鐵表示列車服務有延誤，請留意車站廣播。':'';
    get('.total').textContent=`${rows.length} 班預報`;
    const first=rows[0];
    const eta=row=>Math.ceil((row.at-now)/60000);
    get('.hero-time strong').textContent=first?(eta(first)<=1?(route.station==='TUM'?'即將開出':'即將到站'):eta(first)):'暫無班次';
    get('.hero-time strong').className=!first||eta(first)<=1?'words':'';
    get('.unit').textContent=first&&eta(first)>1?'分鐘':'';
    get('.hero-bottom').textContent=first?`往${route.to} · ${first.plat||'—'} 號月台 · ${clock(first.at)}`:`預報範圍內暫無往${route.to}列車。`;
    get('.later').replaceChildren(...rows.slice(1).map(row=>{
      const item=make('div','train'), info=make('div','train-info');
      info.append(make('strong','',`往${route.to}`),make('span','',`${row.plat||'—'} 號月台 · ${clock(row.at)}`));
      const time=make('div','eta',eta(row));time.append(make('small','','分鐘'));item.append(info,time);return item;
    }));
    if(rows.length<=1)get('.later').append(make('p','empty','暫未有更多符合方向的班次預報。'));
  }
  async function refresh(state) {
    if(state.busy||document.hidden)return;
    state.busy=true;
    state.get('.rail-refresh-button').disabled=true;
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const {line,station}=state.route;
      const response=await fetch(`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${station}&lang=TC`,{signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw Error('http');
      state.result=select(await response.json(),state.route,Date.now());
      state.get('.refresh-info').textContent=`更新 ${clock(state.result.timestamp)} · 15 秒自動更新`;
      render(state);
    } catch(error) {
      clear(state,error.message==='stale'?'資料已過期':'暫未能更新','稍後會自動重試，亦可按下方更新按鈕。');
      state.get('.rail-status').textContent=error.message==='service'?'港鐵暫未提供正常服務資料，請留意車站公告。':'暫時無法取得可靠班次，請檢查網絡及手機時間。';
    } finally {clearTimeout(timeout);state.busy=false;state.get('.rail-refresh-button').disabled=false;}
  }
  const refreshAll=()=>states.forEach(refresh);

  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAll();});
  window.addEventListener('online',refreshAll);
  window.addEventListener('offline',()=>states.forEach(state=>{clear(state,'網絡已中斷','恢復連線後會自動重新讀取。');state.get('.rail-status').textContent='目前沒有網絡連線，已隱藏舊班次。';}));
  setInterval(refreshAll,15000);
  setInterval(()=>states.forEach(render),1000);
  refreshAll();
})();
