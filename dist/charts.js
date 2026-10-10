const occupied = (sim,dock) => ['waiting','docking','loading'].includes(sim.fleet.find(v=>v.id===dock.vehicleId)?.phase);
export function createTelemetry(sim){return {elapsed:sim.elapsed,lastSample:sim.elapsed,received:sim.receivedTotal,loaded:sim.loadedTotal,history:[{time:sim.elapsed,inventory:sim.inventory}],bins:[],busy:Object.fromEntries(sim.docks.map(d=>[d.bay,0]))};}
export function trackTelemetry(log,sim){
  const dt=Math.max(0,sim.elapsed-log.elapsed);
  for(const dock of sim.docks)if(occupied(sim,dock))log.busy[dock.bay]+=dt;
  const time=Math.floor(sim.elapsed/5)*5;
  let bin=log.bins.at(-1);if(!bin||bin.time!==time){bin={time,received:0,loaded:0};log.bins.push(bin);log.bins=log.bins.slice(-12);}
  bin.received+=Math.max(0,sim.receivedTotal-log.received);bin.loaded+=Math.max(0,sim.loadedTotal-log.loaded);
  log.received=sim.receivedTotal;log.loaded=sim.loadedTotal;log.elapsed=sim.elapsed;
  if(sim.elapsed-log.lastSample>=1){log.history.push({time:sim.elapsed,inventory:sim.inventory});log.history=log.history.filter(point=>point.time>=sim.elapsed-60).slice(-61);log.lastSample=sim.elapsed;}
}
export function utilization(log,sim,dock){return sim.elapsed>0?Math.min(100,Math.round(log.busy[dock.bay]/sim.elapsed*100)):(occupied(sim,dock)?100:0);}
export function fleetGroups(sim){return [{name:'入场',color:'#5486e7',value:sim.fleet.filter(v=>['entering','maneuvering','approach'].includes(v.phase)).length},{name:'装货',color:'#57b89d',value:sim.fleet.filter(v=>['waiting','docking','loading'].includes(v.phase)).length},{name:'离场',color:'#dca467',value:sim.fleet.filter(v=>['departing','exiting'].includes(v.phase)).length}];}
const n=value=>Number(value.toFixed(2));
export function ringChart(groups,center,label,size=120){
  const total=groups.reduce((sum,g)=>sum+g.value,0),circumference=2*Math.PI*43;let offset=0;
  const segments=groups.map(g=>{const length=total?g.value/total*circumference:0;const circle=`<circle class="ring-segment" cx="60" cy="60" r="43" stroke="${g.color}" stroke-dasharray="${n(length)} ${n(circumference-length)}" stroke-dashoffset="${n(-offset)}" transform="rotate(-90 60 60)"><title>${g.name} ${g.value}</title></circle>`;offset+=length;return circle;}).join('');
  return `<svg class="data-ring" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${label} ${center}"><circle class="ring-base" cx="60" cy="60" r="43"/>${segments}<text class="ring-number" x="60" y="61">${center}</text><text class="ring-label" x="60" y="79">${label}</text></svg>`;
}
export function inventoryChart(log,current){
  const points=[...log.history];if(points.at(-1).time!==log.elapsed)points.push({time:log.elapsed,inventory:current});
  const values=points.map(p=>p.inventory),min=Math.min(...values)-3,max=Math.max(...values)+3;
  const end=Math.max(60,log.elapsed),start=Math.max(0,end-60),left=33,right=304,top=12,bottom=112;
  const coords=points.map(p=>({x:n(left+(p.time-start)/60*(right-left)),y:n(bottom-(p.inventory-min)/(max-min)*(bottom-top)),...p}));
  const path=coords.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' '),last=coords.at(-1);
  const grids=[0,.5,1].map(t=>{const y=n(bottom-t*(bottom-top));return `<path class="chart-grid" d="M${left} ${y}H${right}"/><text class="chart-axis" x="26" y="${y+3}" text-anchor="end">${Math.round(min+t*(max-min))}</text>`;}).join('');
  return `<svg class="inventory-plot" viewBox="0 0 320 135" role="img" aria-label="库存趋势，当前 ${current} 托盘"><defs><linearGradient id="inventory-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#48b6ff" stop-opacity=".28"/><stop offset="1" stop-color="#48b6ff" stop-opacity="0"/></linearGradient></defs>${grids}<path class="inventory-area" d="${path}L${last.x} ${bottom}L${coords[0].x} ${bottom}Z"/><path class="inventory-line" d="${path}"/><circle class="chart-end" cx="${last.x}" cy="${last.y}" r="3"/>${coords.map(p=>`<circle class="chart-hit" cx="${p.x}" cy="${p.y}" r="5"><title>${Math.floor(p.time)} 秒 · ${p.inventory} 托盘</title></circle>`).join('')}<text class="chart-axis" x="33" y="130">${Math.floor(start)}s</text><text class="chart-axis" x="168" y="130" text-anchor="middle">${Math.floor((start+end)/2)}s</text><text class="chart-axis" x="304" y="130" text-anchor="end">${Math.floor(end)}s</text></svg>`;
}
export function throughputChart(log){
  const end=Math.max(55,Math.floor(log.elapsed/5)*5),start=Math.max(0,end-55),bins=Array.from({length:12},(_,i)=>log.bins.find(b=>b.time===start+i*5)??{time:start+i*5,loaded:0,received:0}),max=Math.max(4,...bins.flatMap(b=>[b.loaded,b.received]));
  const bars=bins.map((b,i)=>{const x=34+i*24,yIn=98-b.received/max*74,yOut=98-b.loaded/max*74;return `<g><rect class="throughput-in" x="${x}" y="${n(yIn)}" width="7" height="${n(98-yIn)}" rx="1.5"/><rect class="throughput-out" x="${x+9}" y="${n(yOut)}" width="7" height="${n(98-yOut)}" rx="1.5"/><rect class="chart-hit" x="${x-2}" y="15" width="22" height="87"><title>${b.time}–${b.time+5} 秒：入库 ${b.received}，装车 ${b.loaded} 托盘</title></rect></g>`;}).join('');
  return `<svg class="throughput-plot" viewBox="0 0 330 120" role="img" aria-label="货物流量，5秒分组，入库与装车托盘数"><path class="chart-grid" d="M32 24H320M32 61H320M32 98H320"/><text class="chart-axis" x="25" y="27" text-anchor="end">${max}</text><text class="chart-axis" x="25" y="101" text-anchor="end">0</text>${bars}<text class="chart-axis" x="34" y="117">${start}s</text><text class="chart-axis" x="174" y="117" text-anchor="middle">${start+30}s</text><text class="chart-axis" x="318" y="117" text-anchor="end">${end+5}s</text></svg>`;
}
