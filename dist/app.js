import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createTelemetry, trackTelemetry, utilization, fleetGroups, ringChart, inventoryChart, throughputChart } from './charts.js';
import { createSimulation, stepSimulation, doorStatus, dockStatus, PHASE_NAMES, FORKLIFT_NAMES, DOCK_Z, ENTRY_Z, EXIT_Z } from './simulation.js';

const $ = s => document.querySelector(s);
// Keep interactive elements mounted while their live text and attributes change.
function updateMarkup(element,markup){
  if(element.innerHTML===markup)return;
  const template=document.createElement('template');template.innerHTML=markup;
  if(!template.content||!element.childNodes){element.innerHTML=markup;return;}
  function patch(parent,nextParent){
    const nextNodes=Array.from(nextParent.childNodes);
    for(let i=0;i<nextNodes.length;i++){
      const next=nextNodes[i],current=parent.childNodes[i];
      if(!current){parent.appendChild(next.cloneNode(true));continue;}
      if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));continue;}
      if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;continue;}
      for(const attribute of Array.from(current.attributes))if(!next.hasAttribute(attribute.name))current.removeAttribute(attribute.name);
      for(const attribute of Array.from(next.attributes))if(current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
      patch(current,next);
    }
    while(parent.childNodes.length>nextNodes.length)parent.lastChild.remove();
  }
  patch(element,template.content);
}
const icon = name => `<svg class="icon"><use href="#i-${name}"/></svg>`;
const vehicleTemplates = [
  {id:'TRK-2148',company:'蓝峰冷链',english:'BLUEPEAK COLD CHAIN',driver:'刘志远',plate:'沪 D·2148',bay:2,shipment:'SHP-78468',customer:'海港食品有限公司'},
  {id:'TRK-2471',company:'远达物流',english:'YUANDA LOGISTICS',driver:'王明',plate:'沪 B·2471',bay:1,shipment:'SHP-78470',customer:'鲜选生鲜供应链'},
  {id:'TRK-2603',company:'蓝峰冷链',english:'BLUEPEAK FOODS',driver:'张伟',plate:'沪 A·7099',bay:3,shipment:'SHP-78472',customer:'海港食品有限公司'}
];
let simulation=createSimulation(vehicleTemplates),telemetry=createTelemetry(simulation),vehicles=simulation.fleet.map(v=>v.vehicle);
const shortPhase={entering:'入场',maneuvering:'入位',approach:'靠台',waiting:'待门',docking:'停靠',loading:'装货',departing:'发车',exiting:'离场'};
let selected=vehicles[0],activeTab='trucks',running=true,speed=1,simSeconds=0,uiElapsed=0,activeDialogBay=null,activeDialogFork=null,activeDialogReceiving=false;
const dockMeshes=new Map(),forkliftMeshes=new Map(),stagingPallets=new Map(),gateMeshes=new Map();
const stateFor=v=>simulation.fleet.find(state=>state.id===v.id);
function syncVehicleState(){
  vehicles=simulation.fleet.map(state=>{const v=state.vehicle;v.status=PHASE_NAMES[state.phase];v.color=state.phase==='loading'?'green':['waiting','maneuvering'].includes(state.phase)?'orange':'';v.position=[state.x,state.z];v.cargo=`${state.loaded} / ${state.capacity} 托盘 · ${state.loaded*205} kg`;v.progress=Math.round(state.loaded/state.capacity*100);v.eta=state.phase==='loading'?`正在装货 · ${state.loaded}/${state.capacity} 托盘`:['departing','exiting'].includes(state.phase)?'装货完成 · 发往配送中心':'入场排队 · 前往装货月台';return v;});
  if(!stateFor(selected)){selected=vehicles.find(v=>v.bay===selected.bay)??vehicles.at(-1);uiElapsed=.3;}
}
syncVehicleState();
let scene,camera,renderer,controls,routeGroup,greenery,selectionRing,marker;
let lastFrame=performance.now(),sceneReady=false,toastTimeout; const truckMeshes=[],sceneLabels=[];
const defaultCamera={position:[48,43,53],target:[0,0,4],zoom:1};
const message = text => { $('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),2800); };
const timeString = () => {const seconds=9*3600+50*60+Math.floor(simSeconds);return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(v=>String(v).padStart(2,'0')).join(':');};
function detail(){
  const v=selected,state=stateFor(v),dock=simulation.docks.find(d=>d.bay===v.bay);
  const ring=ringChart([{name:'已装货',color:'#58d6ff',value:state.loaded},{name:'空余',color:'#203750',value:state.capacity-state.loaded}],Math.round(state.loaded/state.capacity*100)+'%','装载率',116);
  updateMarkup($('#detail-card'),`<div class="chart-heading"><h2>${v.id}</h2><span class="status-pill ${v.color}">${shortPhase[state.phase]}</span><button id="locate-truck" class="icon-button" aria-label="定位车辆" title="定位车辆">${icon('target')}</button></div><div class="vehicle-visual">${ring}<div class="vehicle-values"><div><strong>${running?Math.round(state.velocity*3.6):0}</strong><small>km/h</small></div><div class="door-number"><strong>${Math.round(dock.door.open*100)}<em>%</em></strong><small><i class="state-dot ${dock.door.open>=.999?'is-open':''}"></i>仓库门</small></div></div></div><div class="vehicle-chart-footer"><span><i class="live-dot"></i>${state.loaded} / 8 托盘</span><span>月台 0${v.bay}</span><button id="open-shipment" class="icon-button" aria-label="查看运单详情" title="运单详情">${icon('box')}</button></div>`);
  $('#locate-truck').onclick=()=>focusVehicle(v);$('#open-shipment').onclick=shipmentDialog;
}
function renderCharts(){
  updateMarkup($('#inventory-chart'),inventoryChart(telemetry,simulation.inventory));
  const groups=fleetGroups(simulation);updateMarkup($('#fleet-chart'),ringChart(groups,vehicles.length,'园区车辆',126)+`<div class="fleet-legend">${groups.map(g=>`<div><i style="background:${g.color}"></i><span>${g.name}</span><b>${g.value}</b></div>`).join('')}</div>`);
  updateMarkup($('#throughput-chart'),throughputChart(telemetry));
  updateMarkup($('#dock-chart'),simulation.docks.map(d=>{const u=utilization(telemetry,simulation,d),v=simulation.fleet.find(v=>v.id===d.vehicleId);return `<button class="dock-viz" data-chart-dock="${d.bay}" aria-label="查看月台 ${d.bay}，利用率 ${u}%"><span>0${d.bay}</span><div class="dock-viz-track"><i style="width:${u}%"></i></div><b>${u}<small>%</small></b><i class="state-dot ${d.door.open>=.999?'is-open':''}" title="仓库门 ${doorStatus(d.door)}"></i><small class="dock-viz-state">${v?shortPhase[v.phase]:'空闲'}</small></button>`;}).join(''));
  const max=Math.max(1,...simulation.forklifts.map(f=>f.delivered));updateMarkup($('#forklift-chart'),`<div class="forklift-bars">${simulation.forklifts.map(f=>`<button class="forklift-viz" data-chart-fork="${f.id}" aria-label="查看叉车 ${f.id}，已入库 ${f.delivered} 托盘"><b>${f.delivered}</b><div class="forklift-bar-track"><i style="height:${f.delivered/max*100}%"></i></div><span>${f.id}</span><i class="cargo-dot ${f.loaded?'carrying':''}" title="${f.loaded?'载货':'空车'}"></i></button>`).join('')}</div>`);
  document.querySelectorAll('[data-chart-dock]').forEach(b=>b.onclick=()=>dockDialog(Number(b.dataset.chartDock)));document.querySelectorAll('[data-chart-fork]').forEach(b=>b.onclick=()=>forkliftDialog(b.dataset.chartFork));
}

function assetList(){
  let tiles;
  if(activeTab==='trucks')tiles=vehicles.map(v=>{const state=stateFor(v);return `<button class="asset-tile ${v.id===selected.id?'selected':''}" data-vehicle="${v.id}" aria-label="${v.id} ${v.plate} ${v.status} ${state.loaded}/8 托盘" title="${v.plate} · ${v.status}"><strong>${v.id}</strong><div class="pallet-segments">${Array.from({length:8},(_,i)=>`<i class="${i<state.loaded?'filled':''}"></i>`).join('')}</div><span>${shortPhase[state.phase]}<b>${state.loaded}/8</b></span></button>`;}).join('');
  if(activeTab==='docks')tiles=simulation.docks.map(d=>{const state=simulation.fleet.find(v=>v.id===d.vehicleId);return `<button class="asset-tile" data-dock="${d.bay}" aria-label="月台 ${d.bay} ${dockStatus(state)}，仓库门 ${doorStatus(d.door)}"><strong>DOCK-0${d.bay}</strong><div class="tile-meter"><i style="width:${d.door.open*100}%"></i></div><span>${state?shortPhase[state.phase]:'空闲'}<b>${Math.round(d.door.open*100)}%</b></span></button>`;}).join('');
  if(activeTab==='forklifts')tiles=simulation.forklifts.map(f=>`<button class="asset-tile" data-forklift="${f.id}" aria-label="${f.id} ${FORKLIFT_NAMES[f.phase]}，已入库 ${f.delivered} 托盘"><strong>${f.id}</strong><div class="tile-meter mint-meter"><i style="width:${f.loaded?100:0}%"></i></div><span>${f.loaded?'载货':'空车'}<b>${f.delivered}</b></span></button>`).join('');
  updateMarkup($('#asset-list'),tiles);document.querySelectorAll('[data-vehicle]').forEach(b=>b.onclick=()=>selectVehicle(b.dataset.vehicle,true));document.querySelectorAll('[data-dock]').forEach(b=>b.onclick=()=>dockDialog(Number(b.dataset.dock)));document.querySelectorAll('[data-forklift]').forEach(b=>b.onclick=()=>forkliftDialog(b.dataset.forklift));
}

function setTab(tab){activeTab=tab;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));assetList();}
function selectVehicle(id,focus=false){selected=vehicles.find(v=>v.id===id)??selected;detail();assetList();$('#workspace').classList.add('detail-open');sceneLabels.filter(l=>l.vehicle).forEach(l=>l.element.classList.toggle('selected',l.vehicle===selected.id));if(focus)focusVehicle(selected);}
function focusVehicle(v){if(!sceneReady)return;const mesh=truckMeshes.find(m=>m.userData.vehicle===v.id),p=mesh.position;controls.target.set(p.x,0,p.z);camera.position.set(p.x+28,30,p.z+34);camera.zoom=1.3;camera.updateProjectionMatrix();controls.update();message('已定位 '+v.id);}
function showDialog(content){activeDialogBay=null;activeDialogFork=null;activeDialogReceiving=false;updateMarkup($('#dialog-content'),content);$('#info-dialog').showModal();}
function shipmentDialog(){const v=selected;showDialog(`<span class="dialog-eyebrow">SHIPMENT DETAILS / 运单详情</span><h2>#${v.shipment}</h2><table class="dialog-table"><tr><td>运输承运商</td><td>${v.company}</td></tr><tr><td>配送客户</td><td>${v.customer}</td></tr><tr><td>起运仓库</td><td>WH-03 临港冷链仓 · ${v.bay} 号月台</td></tr><tr><td>目的仓库</td><td>城市冷链配送中心</td></tr><tr><td>司机 / 车牌</td><td>${v.driver} / ${v.plate}</td></tr><tr><td>运输货物</td><td>${v.cargo}</td></tr><tr><td>温控要求</td><td>−18°C ± 2°C</td></tr><tr><td>当前温度</td><td><span class="change">−18.2°C · 温度正常</span></td></tr><tr><td>当前状态</td><td>${v.status}</td></tr></table><p>运单与车辆状态随园区模拟更新。本项目展示数字孪生交互，数据为演示数据。</p>`);}
function dockDialog(bay){
  const dock=simulation.docks.find(d=>d.bay===bay),state=simulation.fleet.find(v=>v.id===dock.vehicleId);
  showDialog(`<span class="dialog-eyebrow">DOCK MANAGEMENT / 月台作业</span><h2>装货月台 ${bay}</h2><div class="dialog-grid"><div class="dialog-stat"><small>月台状态</small><b style="font-size:18px">${dockStatus(state)}</b></div><div class="dialog-stat"><small>装货数量</small><b>${state?.loaded??0}<small>/ 8 托盘</small></b></div><div class="dialog-stat"><small>库存货物</small><b>${simulation.inventory}</b></div></div><table class="dialog-table"><tr><td>关联车辆</td><td>${state?state.id+' · '+state.vehicle.plate:'等待左侧新车入场'}</td></tr><tr><td>仓库门状态</td><td>${doorStatus(dock.door)} · ${Math.round(dock.door.open*100)}%</td></tr><tr><td>车辆联动</td><td>开门到位后停靠 → 逐托盘装货 → 满载右侧离场</td></tr><tr><td>装货条件</td><td>车辆停稳、门已开、仓库有货</td></tr></table>${state?'<button class="dialog-action" id="dock-locate">定位当前车辆</button>':''}`);
  activeDialogBay=bay;if(state)$('#dock-locate').onclick=()=>{$('#info-dialog').close();selectVehicle(state.id,true);};
}
function receivingDialog(){showDialog(`<span class="dialog-eyebrow">INBOUND / 叉车入库</span><h2>WH-02 分拣仓入库口</h2><table class="dialog-table"><tr><td>卷帘门</td><td>${doorStatus(simulation.receivingDoor)}</td></tr><tr><td>已搬运入库</td><td>${simulation.receivedTotal} 托盘</td></tr><tr><td>待入库货物</td><td>${simulation.stagingStock} 托盘</td></tr><tr><td>工作流程</td><td>叉取托盘 → 载货入库 → 放下货物 → 空车返回</td></tr><tr><td>通行规则</td><td>同一时刻只允许一辆叉车进入仓库</td></tr></table>`);activeDialogReceiving=true;}
function forkliftDialog(id){const f=simulation.forklifts.find(f=>f.id===id);showDialog(`<span class="dialog-eyebrow">EQUIPMENT / 叉车任务</span><h2>${id} 入库叉车</h2><div class="dialog-grid"><div class="dialog-stat"><small>当前载货</small><b>${f.loaded?1:0}<small>托盘</small></b></div><div class="dialog-stat"><small>已完成入库</small><b>${f.delivered}</b></div><div class="dialog-stat"><small>当前速度</small><b>${running?Math.round(f.velocity*3.6):0}<small>km/h</small></b></div></div><table class="dialog-table"><tr><td>任务状态</td><td>${FORKLIFT_NAMES[f.phase]}</td></tr><tr><td>取货地点</td><td>园区待入库货物暂存区</td></tr><tr><td>目标地点</td><td>WH-02 分拣仓入库口</td></tr><tr><td>入库门</td><td>${doorStatus(simulation.receivingDoor)}</td></tr></table>`);activeDialogFork=id;}

function analytics(){showDialog(`<span class="dialog-eyebrow">OPERATIONS / 园区运营分析</span><h2>每一次流转，都有迹可循</h2><div class="dialog-grid"><div class="dialog-stat"><small>今日吞吐量</small><b>366<small>托盘</small></b></div><div class="dialog-stat"><small>平均装卸时间</small><b>24<small>分钟</small></b></div><div class="dialog-stat"><small>准时交付率</small><b>96.0%</b></div></div><p>近 7 日园区货物吞吐量（托盘）</p><div class="bar-chart">${[285,340,298,410,365,392,366].map((n,i)=>`<div style="height:${n/4.1}%" title="${['周日','周一','周二','周三','周四','周五','周六'][i]}：${n} 托盘"><span>${['周日','周一','周二','周三','周四','周五','今日'][i]}</span></div>`).join('')}</div><p>统计为演示数据。实际项目可接入 WMS、TMS、GPS 定位与物联网设备数据。</p>`);}

// Geometry is created locally; no remote model or rendering service is required.
const mats={};function material(color,roughness=.7){const key=color+'_'+roughness;return mats[key]??=(new THREE.MeshStandardMaterial({color,roughness,metalness:roughness<.4?.25:0}));}
function box(w,h,d,color,x,y,z,parent=scene,shadow=true){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));mesh.position.set(x,y,z);mesh.castShadow=shadow;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function cylinder(r,height,color,x,y,z,parent=scene,segments=12){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,height,segments),material(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function surfaceText(text,color='#5b77a4',background=null){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const c=canvas.getContext('2d');if(background){c.fillStyle=background;c.fillRect(0,0,512,128);}c.fillStyle=color;c.font='600 55px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(text,256,67);const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false});}
function sign(text,w,h,x,y,z,parent=scene,color){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),surfaceText(text,color));mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
function line(points,color,width=.035,parent=scene){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(points.length*5,2),width,5,false),material(color));parent.add(mesh);return mesh;}
function warehouse(x,z,w,d,name){const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
  box(w+1,.45,d+1,'#dae2ef',0,.2,0,g);box(w,7,d-.8,'#9bb4d3',0,3.8,-.4,g);
  box(w,2.8,.8,'#9bb4d3',0,5.9,d/2-.4,g);
  box(w+.7,.35,d+.7,'#728cac',0,7.55,0,g);box(w+.8,.25,.5,'#6a8cc5',0,7.8,d/2+.12,g);box(.4,.4,d+.5,'#acc0df',-w/2,7.7,0,g);box(.4,.4,d+.5,'#acc0df',w/2,7.7,0,g);
  for(let p=-w/2+1;p<w/2;p+=2)box(.05,6.8,.045,'#dde5f0',p,3.7,d/2+.02,g,false);
  for(let p=-d/2+1;p<d/2;p+=2)box(.045,6.8,.05,'#dce4ef',w/2+.02,3.7,p,g,false);
  box(w,.9,.1,'#dce6f4',0,6.6,d/2+.08,g); sign(name,w*.6,1.2,0,6.7,d/2+.15,g,'#607b9e');
  for(let roofX=-w/2+4;roofX<w/2;roofX+=7){box(4,.18,2.2,'#a7bcdb',roofX,7.9,-1,g);for(let i=0;i<5;i++)box(.045,.01,2.2,'#d5e0f1',roofX-1.6+i*.8,8,-1,g,false);box(2.2,.8,1.8,'#94aac7',roofX,8,3,g);for(const fanX of [-.5,.5]){cylinder(.42,.06,'#bac9de',roofX+fanX,8.45,3,g,18);cylinder(.18,.075,'#dce5f1',roofX+fanX,8.49,3,g,12);}}
  const docks=w>20?[-8,0,8]:[0];
  let wallStart=-w/2;
  for(const dx of docks){const wallEnd=dx-2.1;if(wallEnd>wallStart)box(wallEnd-wallStart,4.3,.8,'#9bb4d3',(wallStart+wallEnd)/2,2.45,d/2-.4,g);wallStart=dx+2.1;}
  if(wallStart<w/2)box(w/2-wallStart,4.3,.8,'#9bb4d3',(wallStart+w/2)/2,2.45,d/2-.4,g);
  docks.forEach((dx,i)=>{
    const bay=w>20?[2,1,3][i]:0;
    box(3.7,3.8,.12,'#32445f',dx,2.45,d/2-.5,g);
    for(const side of [-1.98,1.98])box(.28,4.2,.65,'#718bb1',dx+side,2.5,d/2+.1,g);
    box(4.3,.32,.65,'#7089ad',dx,4.65,d/2+.1,g);
    box(4.3,.43,.65,'#adc2df',dx,4.93,d/2+.08,g);
    const shutter=new THREE.Group();shutter.position.set(dx,2.45,d/2+.44);g.add(shutter);
    box(3.65,3.7,.16,'#d8e3f3',0,0,0,shutter);
    for(let stripe=0;stripe<9;stripe++)box(3.63,.045,.03,'#adc3e0',0,-1.7+stripe*.4,.1,shutter,false);
    box(3.65,.1,.22,'#7897c1',0,-1.8,.04,shutter);
    const indicator=box(.24,.24,.15,'#e67768',dx+2.55,4.3,d/2+.45,g);
    indicator.material=new THREE.MeshBasicMaterial({color:'#e67768'});
    dockMeshes.set(bay,{shutter,indicator});if(bay){addLabel(`月台 ${bay} · ${doorStatus(simulation.docks.find(d=>d.bay===bay).door)}`,[x+dx,5.6,z+d/2+.8],null,false,bay);}
    box(3.45,.8,.55,'#526e9b',dx,.75,d/2+.8,g);box(4,.35,2.5,'#c2cfe3',dx,.48,d/2+1.45,g);
    sign('0'+(bay||1),1.1,.7,dx,5.55,d/2+.25,g,'#5576ac');
    for(const side of [-2.4,2.4]){cylinder(.09,1.1,'#eac66e',dx+side,.7,d/2+2.2,g);box(.2,.25,.2,'#657fa7',dx+side,.45,d/2+2.2,g);}
    box(4.9,.025,10,'#e4eaf5',dx,.49,d/2+6,g,false);for(const side of [-2.5,2.5])box(.085,.035,10,'#e9cc86',dx+side,.52,d/2+6,g,false);
  });
  box(.7,7,.7,'#b8c9e2',w/2+.1,3.8,d/2-.2,g);return g;
}
function tree(x,z,size=1){const g=new THREE.Group();greenery.add(g);g.position.set(x,0,z);cylinder(.12,1.5,'#b5a79c',0,.8,0,g);const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.1,2),material('#4b9685'));crown.scale.set(.85,1.35,.85);crown.position.y=2.2;g.add(crown);crown.castShadow=true;const lower=new THREE.Mesh(new THREE.IcosahedronGeometry(.68,1),material('#62ad98'));lower.position.set(.28,1.6,.3);g.add(lower);g.scale.setScalar(size);}
function pallet(x,z,parent=scene){box(1.3,.15,1,'#bca88c',x,.65,z,parent);box(1.15,1.1,.9,'#f4f5f9',x,1.27,z,parent);box(1.16,.08,.91,'#d8e4f5',x,1.5,z,parent);box(1.18,.05,.94,'#8cacdf',x,.77,z,parent);}
function forklift(state){
  const g=new THREE.Group();g.position.set(state.x,.48,state.z);g.rotation.y=state.yaw;scene.add(g);g.userData.forklift=state.id;g.userData.wheels=[];
  box(1.3,.55,1.8,'#e7bd68',0,.65,0,g);box(1.2,.35,.55,'#f5d082',0,.7,-.72,g);box(.6,.5,.55,'#506785',0,1.08,-.3,g);
  for(const tx of [-.6,.6])for(const tz of [-.6,.65]){const pivot=new THREE.Group();pivot.position.set(tx,.3,tz);g.add(pivot);const wheel=cylinder(.28,.16,'#4d607e',0,0,0,pivot);wheel.rotation.z=Math.PI/2;box(.02,.3,.05,'#d3ddec',Math.sign(tx)*.09,0,0,pivot,false);g.userData.wheels.push(pivot);}
  for(const tx of [-.52,.52]){box(.07,1.4,.07,'#536985',tx,1.5,-.4,g);box(.07,2,.07,'#5a7191',tx,1.3,1,g);}
  box(1.3,.1,1.15,'#6e84a3',0,2.2,-.13,g);
  const carriage=new THREE.Group();g.add(carriage);for(const tx of [-.52,.52])box(.11,.08,1.1,'#91a5c3',tx,.5,1.5,carriage);
  const cargo=new THREE.Group();cargo.position.z=1.65;carriage.add(cargo);pallet(0,0,cargo);cargo.visible=state.loaded;g.userData.carriage=carriage;g.userData.cargo=cargo;
  g.traverse(mesh=>{if(mesh.isMesh)mesh.userData.forklift=state.id;});forkliftMeshes.set(state.id,g);addLabel(`${state.id}<small>叉取货物</small>`,[state.x,3.8,state.z],null,false,null,state.id);return g;
}
function yardGate(name,x,z){
  box(.55,1.5,.55,'#8ca7ce',x,1.15,z+3.5);const arm=new THREE.Group();arm.position.set(x,1.9,z+3.5);scene.add(arm);box(.14,.14,7,'#f8fbff',0,0,-3.5,arm);for(let stripe=0;stripe<8;stripe++)box(.16,.16,.35,'#ecb980',0,0,-.4-stripe*.85,arm);
  const signal=box(.16,.22,.18,'#e6786b',x,1.8,z+3.9);signal.material=new THREE.MeshBasicMaterial({color:'#e6786b'});gateMeshes.set(name,{arm,signal});
  const label=addLabel(name==='entry'?'左侧入口 · 新车入场':'右侧出口 · 满载离场',[x,5,z+4]);label.gate=name;label.element.classList.add('gate-label');
}

function truck(v){const g=new THREE.Group();g.position.set(v.position[0],.53,v.position[1]);scene.add(g);g.userData.vehicle=v.id;
  box(2.7,.28,6.8,'#7387a6',0,.67,0,g);box(2.9,2.6,4.6,'#ffffff',0,2.05,-.8,g);box(2.96,.65,4.65,'#4878dc',0,1.05,-.8,g);box(2.97,.09,4.66,'#abc4f5',0,1.42,-.8,g);box(2.7,1.75,1.9,'#f5f8fe',0,1.65,2.3,g);box(2.55,.65,.12,'#586f90',0,2.07,3.3,g);box(2.55,.12,.18,'#edf4ff',0,1.66,3.32,g);box(2.5,.4,.12,'#5f789b',0,1.25,3.32,g);box(2.8,.18,.28,'#dce6f3',0,.87,3.35,g);box(1,.1,.05,'#a3b7d4',0,1.38,3.4,g);for(const tx of [-1.1,1.1])box(.35,.18,.1,'#fff4cf',tx,1.25,3.4,g);
  box(2.8,.15,2.1,'#e8effa',0,2.57,2.26,g);for(const tx of [-1.39,1.39]){box(.05,.58,.92,'#6984a9',tx,2.03,2.25,g);box(.23,.08,.25,'#8aa0c0',tx*1.13,1.93,2.9,g);}
  g.userData.wheels=[];
  for(const tx of [-1.48,1.48])for(const tz of [-2.2,-1.25,2.3]){
    const pivot=new THREE.Group();pivot.position.set(tx,.57,tz);g.add(pivot);g.userData.wheels.push(pivot);
    const wheel=cylinder(.47,.28,'#526782',0,0,0,pivot,16);wheel.rotation.z=Math.PI/2;
    const hub=cylinder(.23,.3,'#b6c7de',0,0,0,pivot,16);hub.rotation.z=Math.PI/2;
    box(.015,.34,.06,'#e9f1fc',Math.sign(tx)*.16,0,0,pivot,false);
    box(.015,.06,.34,'#e9f1fc',Math.sign(tx)*.16,0,0,pivot,false);
  }
  const side1=sign('BLUEPEAK',3.5,.85,1.49,2.4,-.8,g,'#3d609b');side1.rotation.y=Math.PI/2;const side2=sign('BLUEPEAK',3.5,.85,-1.49,2.4,-.8,g,'#3d609b');side2.rotation.y=-Math.PI/2;
  sign('COLD CHAIN',1.8,.3,0,2.7,3.1,g,'#7394bc');box(2.7,.12,4.4,'#f6f9ff',0,3.43,-.8,g);g.traverse(m=>{if(m.isMesh)m.userData.vehicle=v.id;});truckMeshes.push(g);return g;
}
function addLabel(text,position,vehicle=null,warehouseLabel=false,dock=null,forkliftId=null){const element=document.createElement('button');element.className='scene-label'+(warehouseLabel?' warehouse':'')+(dock?' dock-label':'')+(vehicle===selected.id?' selected':'');element.innerHTML=text;$('#labels').append(element);if(vehicle){element.setAttribute('aria-label','查看车辆 '+vehicle);element.onclick=()=>selectVehicle(vehicle);}else if(warehouseLabel){element.onclick=()=>dockDialog(1);}else if(dock){element.onclick=()=>dockDialog(dock);}else if(forkliftId){element.setAttribute('aria-label','查看叉车 '+forkliftId);element.classList.add('fork-label');element.onclick=()=>forkliftDialog(forkliftId);}const label={element,position:new THREE.Vector3(...position),vehicle,dock,forkliftId};sceneLabels.push(label);return label;}
function createScene(){
  scene=new THREE.Scene();scene.background=new THREE.Color('#081528');scene.fog=new THREE.Fog('#081528',95,170);
  const host=$('#scene'),aspect=host.clientWidth/host.clientHeight,span=Math.max(32,50/aspect);camera=new THREE.OrthographicCamera(-span*aspect,span*aspect,span,-span,.1,250);camera.position.set(...defaultCamera.position);camera.lookAt(...defaultCamera.target);camera.zoom=defaultCamera.zoom;camera.updateProjectionMatrix();
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setSize(host.clientWidth,host.clientHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;host.appendChild(renderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);controls.target.set(...defaultCamera.target);controls.enableDamping=true;controls.dampingFactor=.07;controls.minZoom=.7;controls.maxZoom=3;controls.minPolarAngle=.12;controls.maxPolarAngle=Math.PI*.46;controls.maxDistance=150;controls.enablePan=true;controls.update();
  scene.add(new THREE.HemisphereLight('#a2c4fa','#091628',2));const light=new THREE.DirectionalLight('#d5e7ff',2.7);light.position.set(-25,45,25);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-55,right:55,top:55,bottom:-55,near:1,far:120});light.shadow.bias=-.0004;light.shadow.normalBias=.04;light.shadow.radius=3;scene.add(light);
  box(260,.25,260,'#0a1729',0,-.7,0,scene,false);box(77,.7,66,'#142944',0,-.18,-1);box(70,.18,53,'#203a59',0,.25,-3,scene,false);
  box(100,.04,11,'#142744',0,-.4,35,scene,false);box(100,.06,.3,'#fafcff',0,-.34,29.5,scene,false);box(100,.06,.3,'#fafcff',0,-.34,40.5,scene,false);for(let x=-48;x<49;x+=7)box(3,.04,.16,'#f1f7ff',x,-.35,35,scene,false);
  box(77,.3,2.6,'#f5f8fc',0,.02,27.5);box(2.7,.3,45,'#f6f9fd',-37,.02,-10);box(2.4,.3,34,'#f6f9fd',37,.02,-15);box(76,.18,3,'#183d3b',0,.16,26.1,scene,false);box(2.7,.16,57,'#1a3e3b',-35,.15,-3,scene,false);
  greenery=new THREE.Group();scene.add(greenery);for(let x=-33;x<35;x+=6.5)tree(x,26.5,.85+(x%3)*.025);for(let z=-25;z<20;z+=7)tree(-35,z,.85);
  for(let x=-37;x<=35;x+=4){cylinder(.045,1.8,'#91acc5',x,1.04,28.1,scene,8);box(3.9,1.35,.025,'#c8dbe3',x+2,.98,28.1,scene,false);}box(73,.055,.055,'#a7bdcf',0,1.9,28.1);
  warehouse(0,-15,32,13,'WH-03 · COLD CHAIN');warehouse(-25,-11,9,20,'WH-02');
  for(const [x,z] of [[-35,14],[34,17]]){box(3,2.3,3,'#f5f8fc',x,1.55,z);box(3.4,.25,3.4,'#a5bbdc',x,2.9,z);box(2,1,.06,'#abc9e9',x,1.8,z+1.52);}
  box(94,.035,6,'#1b3658',0,.43,ENTRY_Z,scene,false);box(94,.035,5.5,'#183943',0,.43,EXIT_Z,scene,false);
  yardGate('entry',-34,ENTRY_Z);yardGate('exit',34,EXIT_Z);
  for(let x=-42;x<45;x+=7){line([[x-.4,.5,ENTRY_Z-.4],[x,.5,ENTRY_Z],[x-.4,.5,ENTRY_Z+.4]],'#94b4e9',.04);line([[x-.4,.5,EXIT_Z-.4],[x,.5,EXIT_Z],[x-.4,.5,EXIT_Z+.4]],'#87bfb6',.04);}
  box(16,.03,3.5,'#21443f',-20,.45,6.2,scene,false);addLabel('待入库货物暂存区',[-20,1.5,5.5]);
  for(const f of simulation.forklifts){const group=new THREE.Group();group.position.set(f.pickupX,0,6.35);scene.add(group);pallet(0,0,group);stagingPallets.set(f.id,group);forklift(f);}
  const receivingLabel=addLabel('入库门 · 已关闭',[-25,5.6,-.3]);receivingLabel.receiving=true;receivingLabel.element.classList.add('dock-label');receivingLabel.element.onclick=receivingDialog;
  routeGroup=new THREE.Group();scene.add(routeGroup);line([[-45,.55,ENTRY_Z],[13.5,.55,ENTRY_Z]],'#4eb8fa',.07,routeGroup);line([[-8,.55,EXIT_Z],[45,.55,EXIT_Z]],'#54d8bf',.08,routeGroup);
  for(const x of [-8,0,8])for(let z=-4;z<8;z+=1.5)cylinder(.1,.025,'#7b9fdf',x,.57,z,routeGroup);
  line([[-25,.56,8],[-25,.56,2],[-25,.56,-3]],'#78bcab',.075,routeGroup);
  applySimulationModels();
  selectionRing=new THREE.Mesh(new THREE.RingGeometry(2.3,2.48,64),new THREE.MeshBasicMaterial({color:'#5a8cf5',transparent:true,opacity:.5,side:THREE.DoubleSide,depthWrite:false}));selectionRing.rotation.x=-Math.PI/2;selectionRing.position.y=.61;scene.add(selectionRing);
  marker=new THREE.Group();marker.position.set(8,.6,-.3);routeGroup.add(marker);const cone=new THREE.Mesh(new THREE.ConeGeometry(.65,1.55,20),material('#477bea'));cone.rotation.x=Math.PI;cone.position.y=2.4;marker.add(cone);const sphere=new THREE.Mesh(new THREE.SphereGeometry(.74,20,16),material('#477bea'));sphere.position.y=3.4;marker.add(sphere);const whiteDot=new THREE.Mesh(new THREE.SphereGeometry(.25,14,12),new THREE.MeshBasicMaterial({color:'white'}));whiteDot.position.set(.34,3.58,.59);marker.add(whiteDot);cylinder(.65,.03,'#477bea',0,.05,0,marker,32);
  addLabel('WH-03 <span>临港冷链仓</span>',[0,9,-16],null,true);addLabel('WH-02 <span>分拣中心</span>',[-25,9,-12],null,true).element.onclick=receivingDialog;
  let down;renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects([...truckMeshes,...forkliftMeshes.values()],true)[0];if(hit?.object.userData.vehicle)selectVehicle(hit.object.userData.vehicle);else if(hit?.object.userData.forklift)forkliftDialog(hit.object.userData.forklift);else if(innerWidth<800)$('#workspace').classList.remove('detail-open');});
  new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;const span=Math.max(32,50/(w/h));camera.left=-span*w/h;camera.right=span*w/h;camera.top=span;camera.bottom=-span;camera.updateProjectionMatrix();renderer.setSize(w,h);}).observe(host);
  $('#loading').remove();sceneReady=true;updateSimulationButton();animate();
}
function removeTruck(mesh){
  scene.remove(mesh);truckMeshes.splice(truckMeshes.indexOf(mesh),1);
  const index=sceneLabels.findIndex(label=>label.vehicle===mesh.userData.vehicle);if(index>=0){sceneLabels[index].element.remove();sceneLabels.splice(index,1);}
  mesh.traverse(child=>{if(child.isMesh){child.geometry.dispose();if(child.material.map){child.material.map.dispose();child.material.dispose();}}});
}
function applySimulationModels(){
  syncVehicleState();
  for(const mesh of [...truckMeshes])if(!simulation.fleet.some(state=>state.id===mesh.userData.vehicle))removeTruck(mesh);
  for(const state of simulation.fleet){
    let mesh=truckMeshes.find(m=>m.userData.vehicle===state.id);
    if(!mesh){mesh=truck(state.vehicle);addLabel(`<i class="label-dot"></i>${state.id}<small>${PHASE_NAMES[state.phase]}</small>`,[state.x,5.2,state.z],state.id);}
    mesh.position.set(state.x,.53,state.z);mesh.rotation.y=state.yaw;for(const wheel of mesh.userData.wheels)wheel.rotation.x=state.wheelAngle;
  }
  for(const [bay,mesh] of dockMeshes){const d=bay===0?simulation.receivingDoor:simulation.docks.find(d=>d.bay===bay).door;const height=Math.max(.015,1-d.open);mesh.shutter.scale.y=height;mesh.shutter.position.y=4.3-1.85*height;mesh.indicator.material.color.set(d.open>=.999?'#36bd8e':d.open<=.001?'#e67768':'#f0bd5d');}
  for(const [name,mesh] of gateMeshes){mesh.arm.rotation.x=simulation.gates[name].open*Math.PI/2;mesh.signal.material.color.set(simulation.gates[name].open>=.999?'#36bd8e':'#e6786b');}
  for(const f of simulation.forklifts){const mesh=forkliftMeshes.get(f.id);mesh.position.set(f.x,.48,f.z);mesh.rotation.y=f.yaw;mesh.userData.carriage.position.y=f.lift;mesh.userData.cargo.visible=f.loaded;for(const wheel of mesh.userData.wheels)wheel.rotation.x=f.wheelAngle;stagingPallets.get(f.id).visible=f.phase==='pickup'&&!f.loaded;}
}
function syncSimulationUI(){
  syncVehicleState();detail();renderCharts();assetList();
  const occupied=simulation.docks.filter(d=>d.vehicleId&&['waiting','docking','loading'].includes(simulation.fleet.find(v=>v.id===d.vehicleId)?.phase)).length;
  $('#active-dock-count').textContent=occupied+' / 3';$('#dock-tab-count').textContent=occupied+'/3';$('#truck-tab-count').textContent=vehicles.length;$('#vehicle-count').textContent=vehicles.length;$('#inventory-count').textContent=simulation.inventory;$('#departed-count').textContent=simulation.departed;$('#received-count').textContent=simulation.receivedTotal;
  const percentage=Math.round(occupied/3*100);$('#dock-occupancy').textContent=percentage;$('#occupancy-mini').style.width=percentage+'%';
  for(const label of sceneLabels){
    if(label.vehicle){const v=vehicles.find(v=>v.id===label.vehicle);label.element.innerHTML=`<i class="label-dot"></i>${v.id}<small>${stateFor(v).loaded}/8</small>`;label.element.classList.toggle('selected',v.id===selected.id);}
    if(label.dock){const d=simulation.docks.find(d=>d.bay===label.dock).door;label.element.innerHTML=`月台 0${label.dock}`;label.element.title=doorStatus(d);label.element.classList.toggle('door-open',d.open>=.999);}
    if(label.forkliftId){const f=simulation.forklifts.find(f=>f.id===label.forkliftId);label.element.innerHTML=`${f.id}<small>${f.loaded?'载货':'空车'}</small>`;}
    if(label.receiving){label.element.innerHTML='入库门';label.element.title=doorStatus(simulation.receivingDoor);label.element.classList.toggle('door-open',simulation.receivingDoor.open>=.999);}
    if(label.gate){label.element.innerHTML=label.gate==='entry'?'入口':'出口';label.element.title=doorStatus(simulation.gates[label.gate]);}
  }
  const events=simulation.events.slice(0,3);updateMarkup($('#notification-events'),events.map(e=>`<p><i class="event-dot"></i><b>${e.id} · ${PHASE_NAMES[e.type]??FORKLIFT_NAMES[e.type]??({palletLoaded:'装入 1 托盘',newArrival:'新车左侧入场',stagingReplenished:'收到新货物批次'})[e.type]??'更新任务'}</b><small>模拟运行 ${Math.floor(e.time)} 秒</small></p>`).join('')||'<p><b>装货与叉车入库任务已启动</b></p>');
  if($('#info-dialog').open){if(activeDialogBay!==null)dockDialog(activeDialogBay);else if(activeDialogFork!==null)forkliftDialog(activeDialogFork);else if(activeDialogReceiving)receivingDialog();}
}

function animate(){
  requestAnimationFrame(animate);const now=performance.now(),dt=Math.max(0,Math.min((now-lastFrame)/1000,.1));lastFrame=now;controls.update();
  if(running){stepSimulation(simulation,dt*speed);trackTelemetry(telemetry,simulation);simSeconds=simulation.elapsed;applySimulationModels();uiElapsed+=dt;if(uiElapsed>=.2){syncSimulationUI();uiElapsed=0;}}
  const mesh=truckMeshes.find(m=>m.userData.vehicle===selected.id);selectionRing.position.x=mesh.position.x;selectionRing.position.z=mesh.position.z;selectionRing.material.opacity=.45+Math.sin(now*.002)*.12;marker.position.x=simulation.docks.find(d=>d.bay===selected.bay).x;marker.position.z=DOCK_Z;marker.position.y=.6+Math.sin(now*.002)*.12;
  camera.updateMatrixWorld();sceneLabels.forEach(label=>{if(label.vehicle){const m=truckMeshes.find(m=>m.userData.vehicle===label.vehicle);label.position.set(m.position.x,5.1,m.position.z);}if(label.forkliftId){const mesh=forkliftMeshes.get(label.forkliftId);label.position.set(mesh.position.x,3.8,mesh.position.z);}const p=label.position.clone().project(camera);label.element.style.left=(p.x*.5+.5)*renderer.domElement.clientWidth+'px';label.element.style.top=(-p.y*.5+.5)*renderer.domElement.clientHeight+'px';label.element.style.display=$('#show-labels').checked&&p.z<1&&p.z>-1?'':'none';});
  renderer.render(scene,camera);
}
function updateSimulationButton(){$('#simulation-toggle').innerHTML=icon(running?'pause':'play')+`<span>${running?'暂停模拟':'运行模拟'}</span>`;}
function resetSimulation(){simulation=createSimulation(vehicleTemplates);telemetry=createTelemetry(simulation);simSeconds=0;uiElapsed=0;running=true;selected=simulation.fleet[0].vehicle;applySimulationModels();updateSimulationButton();syncSimulationUI();message('已重置左进右出运输与叉车入库任务');}

detail();renderCharts();assetList();
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-nav]').forEach(n=>n.classList.toggle('active',n===b));if(b.dataset.nav==='analytics')analytics();else if(b.dataset.nav==='trucks'){setTab('trucks');message('车辆管理：点击车辆查看详情');}else if(b.dataset.nav==='docks'){setTab('docks');message('月台管理：点击月台查看作业');}else resetView();});
const togglePopover=id=>{const target=$(id),was=target.hidden;document.querySelectorAll('.popover').forEach(p=>p.hidden=true);target.hidden=!was;};
$('#layer-button').onclick=()=>togglePopover('#layer-popover');$('#settings-button').onclick=()=>togglePopover('#layer-popover');$('#park-button').onclick=()=>togglePopover('#park-popover');$('#notification').onclick=()=>togglePopover('#notification-popover');
document.addEventListener('click',e=>{if(!e.target.closest('.popover,#layer-button,#settings-button,#park-button,#notification'))document.querySelectorAll('.popover').forEach(p=>p.hidden=true);if(!e.target.closest('.search-wrap'))$('#search-results').hidden=true;});
$('#show-route').onchange=e=>{if(routeGroup)routeGroup.visible=e.target.checked;};$('#show-trees').onchange=e=>{if(greenery)greenery.visible=e.target.checked;};
function resetView(){if(!sceneReady)return;camera.position.set(...defaultCamera.position);controls.target.set(...defaultCamera.target);camera.zoom=defaultCamera.zoom;camera.updateProjectionMatrix();controls.update();}
$('#reset-view').onclick=resetView;$('#zoom-in').onclick=()=>{if(sceneReady){camera.zoom=Math.min(3,camera.zoom*1.15);camera.updateProjectionMatrix();}};$('#zoom-out').onclick=()=>{if(sceneReady){camera.zoom=Math.max(.7,camera.zoom/1.15);camera.updateProjectionMatrix();}};
$('#rotate').onclick=()=>{if(!sceneReady)return;const v=camera.position.clone().sub(controls.target);v.applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/6);camera.position.copy(controls.target.clone().add(v));controls.update();};$('#top-view').onclick=()=>{if(!sceneReady)return;controls.target.set(0,0,0);camera.position.set(0,75,.01);camera.zoom=1.45;camera.updateProjectionMatrix();controls.update();message('已切换园区俯视视角');};
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#workspace').requestFullscreen();}catch{message('当前浏览器不支持全屏，可缩放浏览器查看');}};
$('#simulation-toggle').onclick=()=>{if(!sceneReady){message('3D 场景尚未就绪');return;}running=!running;updateSimulationButton();syncSimulationUI();};$('#speed-button').onclick=()=>{speed=speed===1?2:speed===2?4:1;$('#speed-button').textContent=speed+'×';detail();};$('#simulation-reset').onclick=resetSimulation;
$('.dialog-close').onclick=()=>$('#info-dialog').close();$('#info-dialog').addEventListener('click',e=>{if(e.target===$('#info-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#search').addEventListener('input',e=>{const query=e.target.value.trim().toLowerCase();$('#search-results').hidden=!query;if(!query)return;const found=vehicles.filter(v=>[v.id,v.shipment,v.plate,v.driver,v.company,'月台'+v.bay].some(s=>s.toLowerCase().includes(query)));const warehouses=['wh-03','临港','冷链仓'].some(s=>s.includes(query)||query.includes(s));$('#search-results').innerHTML=found.length||warehouses?found.map(v=>`<button data-result="${v.id}"><strong>${v.id}</strong><small>${v.company} · ${v.status}</small></button>`).join('')+(warehouses?'<button id="warehouse-result"><strong>WH-03 临港冷链仓</strong><small>3 / 6 月台作业中</small></button>':''):'<p>未找到匹配资产</p>';document.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{selectVehicle(b.dataset.result,true);$('#search-results').hidden=true;$('#search').value='';});$('#warehouse-result')?.addEventListener('click',()=>{resetView();dockDialog(1);$('#search-results').hidden=true;});});
document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();$('#search').focus();}if(e.key==='Escape'){$('#search-results').hidden=true;document.querySelectorAll('.popover').forEach(p=>p.hidden=true);$('#workspace').classList.remove('detail-open');}});
setInterval(()=>{$('#clock').textContent=timeString();$('#sync-time').textContent=timeString();},1000);
try{createScene();}catch(error){console.error('3D initialization failed',error);$('#loading')?.remove();$('#scene').innerHTML='<div class="fallback"><strong>3D 场景需要 WebGL 支持</strong><span>请使用支持硬件加速的浏览器。数据面板与运单查询仍可使用。</span><button onclick="location.reload()">重新加载</button></div>';}
