'use strict';
(() => {
  function distance(lat, lon, point) {
    const rad = Math.PI / 180;
    const a = Math.sin((point[1]-lat)*rad/2)**2 + Math.cos(lat*rad)*Math.cos(point[1]*rad)*Math.sin((point[0]-lon)*rad/2)**2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0,1-a)));
  }
  function remaining(route, code) {
    const index = route.stations.findIndex(s => s.code === code);
    const target = route.stations.findIndex(s => s.code === route.target);
    if (index < 0 || route.stations[index].branch) return {status:'offroute'};
    if (index > target) return {status:'beyond'};
    return {status:'ok', count:target-index, station:route.stations[index]};
  }
  function locate(route, position, now=Date.now()) {
    const c=position?.coords;
    if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || Math.abs(c.latitude)>90 || Math.abs(c.longitude)>180 || !Number.isFinite(position.timestamp) || now-position.timestamp>60000 || position.timestamp-now>5000) return {status:'stale'};
    if (!Number.isFinite(c.accuracy) || c.accuracy<0 || c.accuracy>150) return {status:'accuracy'};
    const ranked=route.stations.map(station=> {
      const centre=station.points.reduce((sum,p)=>[sum[0]+p[0]/station.points.length,sum[1]+p[1]/station.points.length],[0,0]);
      return {station,metres:Math.min(...[...station.points,centre].map(p=>distance(c.latitude,c.longitude,p)))};
    }).sort((a,b)=>a.metres-b.metres);
    if (!ranked.length || ranked[0].metres>250) return {status:'outside'};
    if (ranked[1] && ranked[1].metres-ranked[0].metres <= 2*c.accuracy+50) return {status:'ambiguous'};
    return remaining(route,ranked[0].station.code);
  }
  if(typeof module!=='undefined' && module.exports){module.exports={distance,remaining,locate};return;}
  const pin='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';
  let enabled=true,watch=null,last=null,generation=0,message='定位中…';
  const views=Object.entries(JOURNEY_ROUTES).map(([key,route])=>{
    const panel=document.getElementById('panel-'+key);
    const box=document.createElement('div');box.className='journey';
    box.innerHTML=`<div class="journey-track" aria-hidden="true"></div><div class="journey-count" role="status" aria-live="polite"></div><button class="journey-gps" type="button">${pin}</button><small class="journey-hint"></small>`;
    panel.querySelector('.hero').after(box);
    const origin=key==='tml'?'TUM':'TIK';
    const first=route.stations.findIndex(s=>s.code===origin);
    const end=route.stations.findIndex(s=>s.code===route.target);
    const stations=route.stations.slice(first,end+1);
    const view={route,box,stations,track:box.querySelector('.journey-track'),count:box.querySelector('.journey-count'),hint:box.querySelector('.journey-hint'),button:box.querySelector('button')};
    view.button.addEventListener('click',()=>{if(enabled){stop();enabled=false;last=null;message='定位已關閉';renderAll();}else{start();}});
    return view;
  });
  const hints={stale:'定位已過期',accuracy:'定位不準',outside:'未接近車站',ambiguous:'未能判斷車站',offroute:'不在此路線',beyond:'已越過目的地'};
  function renderAll(){
    views.forEach(view=>{
      const target=view.stations[view.stations.length-1].name;
      const result=last?locate(view.route,last):null;
      const current=result?.status==='ok'?view.stations.findIndex(s=>s.code===result.station.code):-1;
      const known=current>=0;
      const detail=known?'附近：'+result.station.name:result?.status==='ok'?'未到'+view.stations[0].name:result?hints[result.status]:message;
      const label=known?`${target}，約剩 ${result.count} 站，${detail}`:`${target}，站數未確定，${detail}`;
      const grey=known?Math.min(5,result.count):5;
      view.track.innerHTML=Array.from({length:5},(_,i)=>`<span class="journey-dot ${known?(i<5-grey?'done':'pending'):'unknown'}"></span>`).join('');
      view.count.setAttribute('aria-label',label);
      view.count.textContent=known?`${target} · 還有約 ${result.count} 站`:`${target} · 還有 — 站`;
      view.hint.textContent=detail;
      view.button.setAttribute('aria-label',enabled?'關閉 GPS 定位':'開啟 GPS 定位');
      view.button.setAttribute('aria-pressed',String(enabled));
      view.button.title=enabled?'關閉定位':'開啟定位';
    });
  }
  function stop(){generation++;if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}}
  function start(){
    if(!window.isSecureContext){enabled=false;message='請使用 HTTPS';renderAll();return;}
    if(!navigator.geolocation){enabled=false;message='裝置不支援定位';renderAll();return;}
    stop();enabled=true;last=null;message='定位中…';renderAll();
    const token=generation;
    try {watch=navigator.geolocation.watchPosition(position=>{
      if(token!==generation)return;last=position;renderAll();
    },error=>{
      if(token!==generation)return;last=null;
      message=error.code===1?'未允許定位':error.code===3?'定位逾時':'無定位訊號';
      if(error.code===1){stop();enabled=false;}renderAll();
    },{enableHighAccuracy:true,maximumAge:10000,timeout:15000});}
    catch(error){stop();enabled=false;message='無法啟用定位';renderAll();}
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stop();last=null;message='定位已暫停';renderAll();}
    else if(enabled)start();
  });
  window.addEventListener('pagehide',()=>{stop();last=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted&&enabled)start();});
  setInterval(renderAll,5000);
  renderAll();
  if(!document.hidden)start();
})();
