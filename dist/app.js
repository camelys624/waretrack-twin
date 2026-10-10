import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createSimulation, stepSimulation, doorStatus, dockStatus, PHASE_NAMES, DOCK_Z, YARD_Z } from './simulation.js';

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
const vehicles = [
  {id:'TRK-2148',company:'蓝峰冷链',english:'BLUEPEAK COLD CHAIN',driver:'刘志远',plate:'沪 D·2148',bay:2,shipment:'SHP-78468',customer:'海港食品有限公司',cargo:'6 / 8 托盘 · 1,280 kg',status:'卸货中',color:'green',eta:'09:38 · 已到达',position:[-8,-1.5],progress:83},
  {id:'TRK-2471',company:'远达物流',english:'YUANDA LOGISTICS',driver:'王明',plate:'沪 B·2471',bay:1,shipment:'SHP-78470',customer:'鲜选生鲜供应链',cargo:'4 / 8 托盘 · 860 kg',status:'卸货中',color:'green',eta:'09:43 · 已到达',position:[0,-1.5],progress:70},
  {id:'TRK-2603',company:'蓝峰冷链',english:'BLUEPEAK FOODS',driver:'张伟',plate:'沪 A·7099',bay:3,shipment:'SHP-78472',customer:'海港食品有限公司',cargo:'8 / 8 托盘 · 1,640 kg',status:'驶入月台',color:'',eta:'09:52 · 约 2 分钟',position:[8,15],progress:38}
];
let selected = vehicles[2], activeTab='trucks', running=true, speed=1, simSeconds=0;
let simulation=createSimulation(vehicles),uiElapsed=0,activeDialogBay=null;
const dockMeshes=new Map();
const stateFor=v=>simulation.fleet.find(state=>state.id===v.id);
function syncVehicleState(){for(const v of vehicles){const state=stateFor(v);v.status=PHASE_NAMES[state.phase];v.color=state.phase==='unloading'?'green':state.phase==='waiting'?'orange':'';v.position=[state.x,state.z];v.progress=state.arrived?100:Math.round(38+62*(YARD_Z-state.z)/(YARD_Z-DOCK_Z));v.eta=state.phase==='unloading'?'已到达 · 作业中':state.phase==='departing'?'装卸完成 · 驶离中':state.phase==='standby'?'装卸完成 · 待下一轮':'本轮预计约 20 秒';}}
syncVehicleState();
let scene,camera,renderer,controls,routeGroup,greenery,selectionRing,marker,selectedMesh;
let lastFrame=performance.now(),sceneReady=false,toastTimeout; const truckMeshes=[],sceneLabels=[];
const defaultCamera={position:[48,43,53],target:[0,0,1]};
const message = text => { $('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),2800); };
const timeString = () => {const seconds=9*3600+50*60+Math.floor(simSeconds);return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(v=>String(v).padStart(2,'0')).join(':');};
function detail(){
  const v=selected,state=stateFor(v);
  updateMarkup($('#detail-card'),`<button class="detail-close" id="close-detail" aria-label="关闭车辆详情">×</button><div class="detail-top"><span class="truck-logo">${icon('truck')}</span><div><span class="carrier">${v.english}</span><h2>${v.id}</h2><small>${v.driver} · ${v.plate}</small></div><button id="locate-truck" class="icon-button" aria-label="定位车辆" title="定位车辆">${icon('target')}</button></div><div class="detail-separator"></div><div class="status-line"><span class="status-pill ${v.color}">${v.status}</span><span>${['approach','waiting','docking'].includes(state.phase)?'前往':'关联'} ${v.bay} 号月台 · WH-03</span></div><div class="progress-line"><span style="width:${v.progress}%"></span></div><div class="distance">${['approach','waiting','docking'].includes(state.phase)?`${Math.max(0,Math.round(state.z-DOCK_Z))} m 至月台`:state.phase==='unloading'?`装卸作业 · 第 ${state.cycles+1} 轮`:'园区循环作业'}</div><dl class="detail-rows"><div><dt>运单编号</dt><dd class="link">#${v.shipment}</dd></div><div><dt>客户</dt><dd>${v.customer}</dd></div><div><dt>目的地</dt><dd>WH-03 临港冷链仓</dd></div><div><dt>预计到达</dt><dd>${v.eta}</dd></div><div><dt>实时速度</dt><dd>${running?Math.round(Math.abs(state.velocity)*3.6):0} km/h</dd></div><div><dt>仓库门联动</dt><dd class="link">${doorStatus(state.door)} · ${Math.round(state.door.open*100)}%</dd></div><div><dt>感应状态</dt><dd>${state.door.target?'检测到车辆 · 保持开启':'车辆已离开感应区'}</dd></div><div><dt>目标月台</dt><dd class="link">月台 ${v.bay} · WH-03</dd></div><div><dt>运输货物</dt><dd>${v.cargo}</dd></div></dl><div class="detail-footer"><span><i></i> GPS 信号正常</span><button id="open-shipment">查看运单 ↗</button></div>`);
  $('#close-detail').onclick=()=>$('#workspace').classList.remove('detail-open');$('#locate-truck').onclick=()=>focusVehicle(v); $('#open-shipment').onclick=shipmentDialog;
  $('#tracking-truck').textContent=`${v.id} · ${v.company}`;$('#shipment-id').textContent='#'+v.shipment;$('#shipment-state').textContent='● '+v.status;
  const done=state.arrived;
  const steps=[['订单确认','07:07','box'],['货物提取','08:34','check'],['装车完成','09:18','box'],['运输途中','09:32','truck'],['送达仓库',done?'已到达':'ETA 09:52','check']];
  $('#timeline').innerHTML=steps.map((s,i)=>`<div class="timeline-step ${i<(done?4:3)?'done':i===(done?4:3)?'current':''}"><span class="step-circle">${icon(s[2])}</span><b>${s[0]}</b><small>${s[1]}</small></div>`).join('');
}
function assetList(){
  let rows;
  if(activeTab==='trucks')rows=vehicles.map(v=>`<button class="asset-row ${v.id===selected.id?'selected':''}" data-vehicle="${v.id}"><span><strong>${v.id}</strong><small>${v.company}</small></span><span class="asset-location"><i></i>${['unloading','docking','waiting'].includes(stateFor(v).phase)?'月台 '+v.bay:stateFor(v).phase==='departing'?'驶离 WH-03':stateFor(v).phase==='standby'?'园区待命':'前往 WH-03'}</span><span class="status-pill ${v.color}">${v.status}</span>${icon('chevron')}</button>`).join('');
  if(activeTab==='docks')rows=[1,2,3].map(bay=>{const v=vehicles.find(v=>v.bay===bay),state=stateFor(v);return `<button class="asset-row" data-dock="${bay}"><span><strong>DOCK-0${bay}</strong><small>仓库门 ${doorStatus(state.door)}</small></span><span class="asset-location"><i></i>${v.id}</span><span class="status-pill ${v.color}">${dockStatus(state)}</span>${icon('chevron')}</button>`;}).join('');
  if(activeTab==='forklifts')rows=[['FL-001','84%','作业中','green'],['FL-002','67%','作业中','green'],['FL-003','18%','待充电','orange']].map(v=>`<button class="asset-row" data-forklift="${v[0]}"><span><strong>${v[0]}</strong><small>电动平衡重叉车</small></span><span class="asset-location"><i></i>电量 ${v[1]}</span><span class="status-pill ${v[3]}">${v[2]}</span>${icon('chevron')}</button>`).join('');
  updateMarkup($('#asset-list'),rows);
  document.querySelectorAll('[data-vehicle]').forEach(b=>b.onclick=()=>selectVehicle(b.dataset.vehicle,true));
  document.querySelectorAll('[data-dock]').forEach(b=>b.onclick=()=>dockDialog(Number(b.dataset.dock)));
  document.querySelectorAll('[data-forklift]').forEach(b=>b.onclick=()=>forkliftDialog(b.dataset.forklift));
}
function setTab(tab){activeTab=tab;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));assetList();}
function selectVehicle(id,focus=false){selected=vehicles.find(v=>v.id===id);detail();assetList();$('#workspace').classList.add('detail-open');sceneLabels.filter(l=>l.vehicle).forEach(l=>l.element.classList.toggle('selected',l.vehicle===selected.id));if(focus)focusVehicle(selected);}
function focusVehicle(v){if(!sceneReady)return;const mesh=truckMeshes.find(m=>m.userData.vehicle===v.id),p=mesh.position;controls.target.set(p.x,0,p.z);camera.position.set(p.x+28,30,p.z+34);camera.zoom=1.3;camera.updateProjectionMatrix();controls.update();message('已定位 '+v.id);}
function showDialog(content){activeDialogBay=null;updateMarkup($('#dialog-content'),content);$('#info-dialog').showModal();}
function shipmentDialog(){const v=selected;showDialog(`<span class="dialog-eyebrow">SHIPMENT DETAILS / 运单详情</span><h2>#${v.shipment}</h2><table class="dialog-table"><tr><td>运输承运商</td><td>${v.company}</td></tr><tr><td>配送客户</td><td>${v.customer}</td></tr><tr><td>起运仓库</td><td>苏州食品分拨中心</td></tr><tr><td>目的仓库</td><td>WH-03 临港冷链仓 · ${v.bay} 号月台</td></tr><tr><td>司机 / 车牌</td><td>${v.driver} / ${v.plate}</td></tr><tr><td>运输货物</td><td>${v.cargo}</td></tr><tr><td>温控要求</td><td>−18°C ± 2°C</td></tr><tr><td>当前温度</td><td><span class="change">−18.2°C · 温度正常</span></td></tr><tr><td>当前状态</td><td>${v.status}</td></tr></table><p>运单与车辆状态随园区模拟更新。本项目展示数字孪生交互，数据为演示数据。</p>`);}
function dockDialog(bay){const v=vehicles.find(v=>v.bay===bay),state=stateFor(v);showDialog(`<span class="dialog-eyebrow">DOCK MANAGEMENT / 月台作业</span><h2>冷链月台 ${bay}</h2><div class="dialog-grid"><div class="dialog-stat"><small>当前状态</small><b style="font-size:18px">${dockStatus(state)}</b></div><div class="dialog-stat"><small>今日吞吐</small><b>${[126,148,92][bay-1]}<small>托盘</small></b></div><div class="dialog-stat"><small>利用率</small><b>${[76,82,63][bay-1]}%</b></div></div><table class="dialog-table"><tr><td>预约车辆</td><td>${v.id} · ${v.plate}</td></tr><tr><td>运单编号</td><td>#${v.shipment}</td></tr><tr><td>仓库门状态</td><td>${doorStatus(state.door)} · ${Math.round(state.door.open*100)}%</td></tr><tr><td>车辆联动</td><td>接近自动开门 · 门开到位才允许停靠 · 驶离自动关门</td></tr><tr><td>装卸设备</td><td>液压登车桥 · 状态正常</td></tr><tr><td>温控分区</td><td>冷冻 A 区 / −18°C</td></tr></table><button class="dialog-action" id="dock-locate">定位预约车辆</button>`);activeDialogBay=bay;$('#dock-locate').onclick=()=>{$('#info-dialog').close();selectVehicle(v.id,true);};}
function forkliftDialog(id){const index=Number(id.slice(-1))-1;showDialog(`<span class="dialog-eyebrow">EQUIPMENT / 设备信息</span><h2>${id} 电动叉车</h2><div class="dialog-grid"><div class="dialog-stat"><small>设备电量</small><b>${[84,67,18][index]}%</b></div><div class="dialog-stat"><small>今日搬运</small><b>${[68,52,36][index]}</b></div><div class="dialog-stat"><small>额定载重</small><b>2.5<small>吨</small></b></div></div><table class="dialog-table"><tr><td>运行状态</td><td>${index===2?'待充电':'作业中'}</td></tr><tr><td>当前位置</td><td>${index===2?'设备补给区':'冷链仓 · '+(index+1)+'号月台'}</td></tr><tr><td>今日运行时间</td><td>${[3.2,2.8,2.1][index]} 小时</td></tr><tr><td>保养状态</td><td>正常 · 下次保养 2026-11-01</td></tr></table>`);}
function analytics(){showDialog(`<span class="dialog-eyebrow">OPERATIONS / 园区运营分析</span><h2>每一次流转，都有迹可循</h2><div class="dialog-grid"><div class="dialog-stat"><small>今日吞吐量</small><b>366<small>托盘</small></b></div><div class="dialog-stat"><small>平均装卸时间</small><b>24<small>分钟</small></b></div><div class="dialog-stat"><small>准时交付率</small><b>96.0%</b></div></div><p>近 7 日园区货物吞吐量（托盘）</p><div class="bar-chart">${[285,340,298,410,365,392,366].map((n,i)=>`<div style="height:${n/4.1}%" title="${['周日','周一','周二','周三','周四','周五','周六'][i]}：${n} 托盘"><span>${['周日','周一','周二','周三','周四','周五','今日'][i]}</span></div>`).join('')}</div><p>统计为演示数据。实际项目可接入 WMS、TMS、GPS 定位与物联网设备数据。</p>`);}

// Geometry is created locally; no remote model or rendering service is required.
const mats={};function material(color,roughness=.7){const key=color+'_'+roughness;return mats[key]??=(new THREE.MeshStandardMaterial({color,roughness,metalness:roughness<.4?.25:0}));}
function box(w,h,d,color,x,y,z,parent=scene,shadow=true){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));mesh.position.set(x,y,z);mesh.castShadow=shadow;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function cylinder(r,height,color,x,y,z,parent=scene,segments=12){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,height,segments),material(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function surfaceText(text,color='#5b77a4',background=null){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const c=canvas.getContext('2d');if(background){c.fillStyle=background;c.fillRect(0,0,512,128);}c.fillStyle=color;c.font='600 55px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(text,256,67);const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false});}
function sign(text,w,h,x,y,z,parent=scene,color){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),surfaceText(text,color));mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
function line(points,color,width=.035,parent=scene){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(points.length*5,2),width,5,false),material(color));parent.add(mesh);return mesh;}
function warehouse(x,z,w,d,name){const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
  box(w+1,.45,d+1,'#dae2ef',0,.2,0,g);box(w,7,d-.8,'#f6f8fd',0,3.8,-.4,g);
  box(w,2.8,.8,'#f6f8fd',0,5.9,d/2-.4,g);
  box(w+.7,.35,d+.7,'#c4d2e7',0,7.55,0,g);box(w+.8,.25,.5,'#6a8cc5',0,7.8,d/2+.12,g);box(.4,.4,d+.5,'#acc0df',-w/2,7.7,0,g);box(.4,.4,d+.5,'#acc0df',w/2,7.7,0,g);
  for(let p=-w/2+1;p<w/2;p+=2)box(.05,6.8,.045,'#dde5f0',p,3.7,d/2+.02,g,false);
  for(let p=-d/2+1;p<d/2;p+=2)box(.045,6.8,.05,'#dce4ef',w/2+.02,3.7,p,g,false);
  box(w,.9,.1,'#dce6f4',0,6.6,d/2+.08,g); sign(name,w*.6,1.2,0,6.7,d/2+.15,g,'#607b9e');
  for(let roofX=-w/2+4;roofX<w/2;roofX+=7){box(4,.18,2.2,'#a7bcdb',roofX,7.9,-1,g);for(let i=0;i<5;i++)box(.045,.01,2.2,'#d5e0f1',roofX-1.6+i*.8,8,-1,g,false);box(2.2,.8,1.8,'#e6ebf3',roofX,8,3,g);for(const fanX of [-.5,.5]){cylinder(.42,.06,'#bac9de',roofX+fanX,8.45,3,g,18);cylinder(.18,.075,'#dce5f1',roofX+fanX,8.49,3,g,12);}}
  const docks=w>20?[-8,0,8]:[0];
  let wallStart=-w/2;
  for(const dx of docks){const wallEnd=dx-2.1;if(wallEnd>wallStart)box(wallEnd-wallStart,4.3,.8,'#f6f8fd',(wallStart+wallEnd)/2,2.45,d/2-.4,g);wallStart=dx+2.1;}
  if(wallStart<w/2)box(w/2-wallStart,4.3,.8,'#f6f8fd',(wallStart+w/2)/2,2.45,d/2-.4,g);
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
    if(bay){dockMeshes.set(bay,{shutter,indicator});addLabel(`月台 ${bay} · ${doorStatus(stateFor(vehicles.find(v=>v.bay===bay)).door)}`,[x+dx,5.6,z+d/2+.8],null,false,bay);}
    box(3.45,.8,.55,'#526e9b',dx,.75,d/2+.8,g);box(4,.35,2.5,'#c2cfe3',dx,.48,d/2+1.45,g);
    sign('0'+(bay||1),1.1,.7,dx,5.55,d/2+.25,g,'#5576ac');
    for(const side of [-2.4,2.4]){cylinder(.09,1.1,'#eac66e',dx+side,.7,d/2+2.2,g);box(.2,.25,.2,'#657fa7',dx+side,.45,d/2+2.2,g);}
    box(4.9,.025,10,'#e4eaf5',dx,.49,d/2+6,g,false);for(const side of [-2.5,2.5])box(.085,.035,10,'#e9cc86',dx+side,.52,d/2+6,g,false);
  });
  box(.7,7,.7,'#b8c9e2',w/2+.1,3.8,d/2-.2,g);return g;
}
function tree(x,z,size=1){const g=new THREE.Group();greenery.add(g);g.position.set(x,0,z);cylinder(.12,1.5,'#b5a79c',0,.8,0,g);const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.1,2),material('#9dceb5'));crown.scale.set(.85,1.35,.85);crown.position.y=2.2;g.add(crown);crown.castShadow=true;const lower=new THREE.Mesh(new THREE.IcosahedronGeometry(.68,1),material('#b5dec2'));lower.position.set(.28,1.6,.3);g.add(lower);g.scale.setScalar(size);}
function pallet(x,z,parent=scene){box(1.3,.15,1,'#bca88c',x,.65,z,parent);box(1.15,1.1,.9,'#f4f5f9',x,1.27,z,parent);box(1.16,.08,.91,'#d8e4f5',x,1.5,z,parent);box(1.18,.05,.94,'#8cacdf',x,.77,z,parent);}
function forklift(x,z,rotation=0){const g=new THREE.Group();g.position.set(x,.48,z);g.rotation.y=rotation;scene.add(g);box(1.3,.55,1.8,'#e7bd68',0,.65,0,g);box(1.2,.35,.55,'#f5d082',0,.7,-.72,g);box(.6,.5,.55,'#506785',0,1.08,-.3,g);for(const tx of [-.6,.6])for(const tz of [-.6,.65]){const wheel=cylinder(.28,.16,'#4d607e',tx,.3,tz,g);wheel.rotation.z=Math.PI/2;}for(const tx of [-.52,.52]){box(.07,1.4,.07,'#536985',tx,1.5,-.4,g);box(.07,2,.07,'#5a7191',tx,1.3,1,g);box(.11,.08,1.1,'#91a5c3',tx,.5,1.5,g);}box(1.3,.1,1.15,'#6e84a3',0,2.2,-.13,g);return g;}
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
function addLabel(text,position,vehicle=null,warehouseLabel=false,dock=null){const element=document.createElement('button');element.className='scene-label'+(warehouseLabel?' warehouse':'')+(dock?' dock-label':'')+(vehicle===selected.id?' selected':'');element.innerHTML=text;$('#labels').append(element);if(vehicle){element.setAttribute('aria-label','查看车辆 '+vehicle);element.onclick=()=>selectVehicle(vehicle);}else if(warehouseLabel){element.onclick=()=>dockDialog(1);}else if(dock){element.onclick=()=>dockDialog(dock);}sceneLabels.push({element,position:new THREE.Vector3(...position),vehicle,dock});}
function createScene(){
  scene=new THREE.Scene();scene.background=new THREE.Color('#edf2fa');scene.fog=new THREE.Fog('#edf2fa',95,170);
  const host=$('#scene'), aspect=host.clientWidth/host.clientHeight;camera=new THREE.OrthographicCamera(-42*aspect,42*aspect,42,-42,.1,250);camera.position.set(...defaultCamera.position);camera.lookAt(...defaultCamera.target);camera.zoom=1.4;camera.updateProjectionMatrix();
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setSize(host.clientWidth,host.clientHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;host.appendChild(renderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);controls.target.set(...defaultCamera.target);controls.enableDamping=true;controls.dampingFactor=.07;controls.minZoom=.7;controls.maxZoom=3;controls.minPolarAngle=.12;controls.maxPolarAngle=Math.PI*.46;controls.maxDistance=150;controls.enablePan=true;controls.update();
  scene.add(new THREE.HemisphereLight('#ffffff','#b6c8e4',2.4));const light=new THREE.DirectionalLight('#fff7ee',3.5);light.position.set(-25,45,25);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-55,right:55,top:55,bottom:-55,near:1,far:120});light.shadow.bias=-.0004;light.shadow.normalBias=.04;light.shadow.radius=3;scene.add(light);
  box(260,.25,260,'#e7eef9',0,-.7,0,scene,false);box(77,.7,66,'#e7edf7',0,-.18,-1);box(70,.18,53,'#dfe8f5',0,.25,-3,scene,false);
  box(100,.04,11,'#c3d5ef',0,-.4,35,scene,false);box(100,.06,.3,'#fafcff',0,-.34,29.5,scene,false);box(100,.06,.3,'#fafcff',0,-.34,40.5,scene,false);for(let x=-48;x<49;x+=7)box(3,.04,.16,'#f1f7ff',x,-.35,35,scene,false);
  box(77,.3,2.6,'#f5f8fc',0,.02,27.5);box(2.7,.3,59,'#f6f9fd',-37,.02,-3);box(2.4,.3,59,'#f6f9fd',37,.02,-3);box(76,.18,3,'#d7e9e1',0,.16,26.1,scene,false);box(2.7,.16,57,'#d8eae2',-35,.15,-3,scene,false);
  greenery=new THREE.Group();scene.add(greenery);for(let x=-33;x<35;x+=6.5)tree(x,26.5,.85+(x%3)*.025);for(let z=-25;z<20;z+=7)tree(-35,z,.85);
  for(let x=-37;x<=35;x+=4){cylinder(.045,1.8,'#91acc5',x,1.04,28.1,scene,8);box(3.9,1.35,.025,'#c8dbe3',x+2,.98,28.1,scene,false);}box(73,.055,.055,'#a7bdcf',0,1.9,28.1);
  warehouse(0,-15,32,13,'WH-03 · COLD CHAIN');warehouse(-25,-11,9,20,'WH-02');
  box(6,2.7,4,'#f5f8fc',29,1.8,20);box(6.4,.25,4.4,'#a5bbdc',29,3.35,20);box(3,1,.07,'#b0c9e5',29,2.2,22.05);sign('GATE 01',3,.55,29,3.02,22.18);box(.35,1.5,.35,'#86a0c7',24,.95,22);box(7,.14,.18,'#f9fafb',20.7,1.55,22);for(let x=17.5;x<24;x+=.8)box(.35,.16,.2,'#edb78a',x,1.55,22);
  for(let z=5;z<23;z+=4)box(.12,.025,1.5,'#f4f8ff',23,.4,z,scene,false);for(let x=-25;x<22;x+=7)box(2.2,.025,.12,'#f3f7ff',x,.4,19,scene,false);
  for(let i=0;i<3;i++)pallet(16+i*1.4,-6);for(let i=0;i<3;i++)pallet(-16,5+i*1.3);forklift(14,-3,-.3);forklift(-16,9,Math.PI/2);forklift(-28,8,Math.PI);
  vehicles.forEach(v=>truck(v));selectedMesh=truckMeshes[2];applySimulationModels();
  routeGroup=new THREE.Group();scene.add(routeGroup);const routePoints=[[23,.56,23],[8,.56,23],[8,.56,15]];line(routePoints,'#3b79f3',.15,routeGroup);
  for(const x of [-8,0])line([[x,.54,19],[x,.54,DOCK_Z]],'#b5c9ed',.05,routeGroup);
  for(let z=-4;z<15;z+=1.4){const dot=cylinder(.14,.025,'#4b83ef',8,.58,z,routeGroup);}
  for(let z=16;z<23;z+=3){line([[7.7,.73,z+.3],[8,.73,z],[8.3,.73,z+.3]],'#d6e8ff',.045,routeGroup);}
  for(let x=11;x<24;x+=4)line([[x+.3,.74,22.7],[x,.74,23],[x+.3,.74,23.3]],'#d6e8ff',.045,routeGroup);
  selectionRing=new THREE.Mesh(new THREE.RingGeometry(2.3,2.48,64),new THREE.MeshBasicMaterial({color:'#5a8cf5',transparent:true,opacity:.5,side:THREE.DoubleSide,depthWrite:false}));selectionRing.rotation.x=-Math.PI/2;selectionRing.position.y=.61;scene.add(selectionRing);
  marker=new THREE.Group();marker.position.set(8,.6,-.3);routeGroup.add(marker);const cone=new THREE.Mesh(new THREE.ConeGeometry(.65,1.55,20),material('#477bea'));cone.rotation.x=Math.PI;cone.position.y=2.4;marker.add(cone);const sphere=new THREE.Mesh(new THREE.SphereGeometry(.74,20,16),material('#477bea'));sphere.position.y=3.4;marker.add(sphere);const whiteDot=new THREE.Mesh(new THREE.SphereGeometry(.25,14,12),new THREE.MeshBasicMaterial({color:'white'}));whiteDot.position.set(.34,3.58,.59);marker.add(whiteDot);cylinder(.65,.03,'#477bea',0,.05,0,marker,32);
  addLabel('WH-03 <span>临港冷链仓</span>',[0,9,-16],null,true);addLabel('WH-02 <span>分拣中心</span>',[-25,9,-12],null,true);
  vehicles.forEach(v=>addLabel(`<i class="label-dot"></i>${v.id}<small>${v.status}</small>`,[v.position[0],5.2,v.position[1]],v.id));
  let down;renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects(truckMeshes,true)[0];if(hit)selectVehicle(hit.object.userData.vehicle);else if(innerWidth<800)$('#workspace').classList.remove('detail-open');});
  new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;camera.left=-42*w/h;camera.right=42*w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);}).observe(host);
  $('#loading').remove();sceneReady=true;updateSimulationButton();animate();
}
function applySimulationModels(){
  for(const state of simulation.fleet){
    const mesh=truckMeshes.find(m=>m.userData.vehicle===state.id);
    if(mesh){mesh.position.set(state.x,.53,state.z);for(const wheel of mesh.userData.wheels)wheel.rotation.x=state.wheelAngle;}
    const dock=dockMeshes.get(state.bay);
    if(dock){const height=Math.max(.015,1-state.door.open);dock.shutter.scale.y=height;dock.shutter.position.y=4.3-1.85*height;dock.indicator.material.color.set(state.door.open>=.999?'#36bd8e':state.door.open<=.001?'#e67768':'#f0bd5d');}
  }
}
function syncSimulationUI(){
  syncVehicleState();detail();assetList();
  const occupied=simulation.fleet.filter(v=>['waiting','docking','unloading'].includes(v.phase)).length;
  $('#active-dock-count').textContent=occupied+' / 6';$('#dock-tab-count').textContent=occupied+'/6';
  for(const label of sceneLabels){
    if(label.vehicle){const v=vehicles.find(v=>v.id===label.vehicle);label.element.innerHTML=`<i class="label-dot"></i>${v.id}<small>${v.status}</small>`;}
    if(label.dock){const state=simulation.fleet.find(v=>v.bay===label.dock);label.element.innerHTML=`月台 ${label.dock} · ${doorStatus(state.door)}`;label.element.classList.toggle('door-open',state.door.open>=.999);}
  }
  if($('#info-dialog').open&&activeDialogBay!==null)dockDialog(activeDialogBay);
}
function animate(){
  requestAnimationFrame(animate);const now=performance.now(),dt=Math.max(0,Math.min((now-lastFrame)/1000,.1));lastFrame=now;controls.update();
  if(running){stepSimulation(simulation,dt*speed);simSeconds=simulation.elapsed*3.75;applySimulationModels();uiElapsed+=dt;if(uiElapsed>=.2){syncSimulationUI();uiElapsed=0;}}
  const mesh=truckMeshes.find(m=>m.userData.vehicle===selected.id);selectionRing.position.x=mesh.position.x;selectionRing.position.z=mesh.position.z;selectionRing.material.opacity=.45+Math.sin(now*.002)*.12;marker.position.x=stateFor(selected).x;marker.position.z=DOCK_Z;marker.position.y=.6+Math.sin(now*.002)*.12;
  camera.updateMatrixWorld();sceneLabels.forEach(label=>{if(label.vehicle){const m=truckMeshes.find(m=>m.userData.vehicle===label.vehicle);label.position.set(m.position.x,5.1,m.position.z);}const p=label.position.clone().project(camera);label.element.style.left=(p.x*.5+.5)*renderer.domElement.clientWidth+'px';label.element.style.top=(-p.y*.5+.5)*renderer.domElement.clientHeight+'px';label.element.style.display=$('#show-labels').checked&&p.z<1&&p.z>-1?'':'none';});
  renderer.render(scene,camera);
}
function updateSimulationButton(){$('#simulation-toggle').innerHTML=icon(running?'pause':'play')+`<span>${running?'暂停模拟':'运行模拟'}</span>`;}
function resetSimulation(){simulation=createSimulation(vehicles.map(v=>({...v,position:[stateFor(v).x,v.id==='TRK-2603'?15:DOCK_Z]})));simSeconds=0;uiElapsed=0;running=true;applySimulationModels();updateSimulationButton();syncSimulationUI();message('三车与仓库门联动已重置');}

detail();assetList();
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-nav]').forEach(n=>n.classList.toggle('active',n===b));if(b.dataset.nav==='analytics')analytics();else if(b.dataset.nav==='trucks'){setTab('trucks');message('车辆管理：点击车辆查看详情');}else if(b.dataset.nav==='docks'){setTab('docks');message('月台管理：点击月台查看作业');}else resetView();});
const togglePopover=id=>{const target=$(id),was=target.hidden;document.querySelectorAll('.popover').forEach(p=>p.hidden=true);target.hidden=!was;};
$('#layer-button').onclick=()=>togglePopover('#layer-popover');$('#settings-button').onclick=()=>togglePopover('#layer-popover');$('#park-button').onclick=()=>togglePopover('#park-popover');$('#notification').onclick=()=>togglePopover('#notification-popover');
document.addEventListener('click',e=>{if(!e.target.closest('.popover,#layer-button,#settings-button,#park-button,#notification'))document.querySelectorAll('.popover').forEach(p=>p.hidden=true);if(!e.target.closest('.search-wrap'))$('#search-results').hidden=true;});
$('#show-route').onchange=e=>{if(routeGroup)routeGroup.visible=e.target.checked;};$('#show-trees').onchange=e=>{if(greenery)greenery.visible=e.target.checked;};
function resetView(){if(!sceneReady)return;camera.position.set(...defaultCamera.position);controls.target.set(...defaultCamera.target);camera.zoom=1.4;camera.updateProjectionMatrix();controls.update();}
$('#reset-view').onclick=resetView;$('#zoom-in').onclick=()=>{if(sceneReady){camera.zoom=Math.min(3,camera.zoom*1.15);camera.updateProjectionMatrix();}};$('#zoom-out').onclick=()=>{if(sceneReady){camera.zoom=Math.max(.7,camera.zoom/1.15);camera.updateProjectionMatrix();}};
$('#rotate').onclick=()=>{if(!sceneReady)return;const v=camera.position.clone().sub(controls.target);v.applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/6);camera.position.copy(controls.target.clone().add(v));controls.update();};$('#top-view').onclick=()=>{if(!sceneReady)return;controls.target.set(0,0,0);camera.position.set(0,75,.01);camera.zoom=1.45;camera.updateProjectionMatrix();controls.update();message('已切换园区俯视视角');};
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#workspace').requestFullscreen();}catch{message('当前浏览器不支持全屏，可缩放浏览器查看');}};
$('#simulation-toggle').onclick=()=>{if(!sceneReady){message('3D 场景尚未就绪');return;}running=!running;updateSimulationButton();syncSimulationUI();};$('#speed-button').onclick=()=>{speed=speed===1?2:speed===2?4:1;$('#speed-button').textContent=speed+'×';detail();};$('#simulation-reset').onclick=resetSimulation;
$('#shipment-card').onclick=shipmentDialog;$('.dialog-close').onclick=()=>$('#info-dialog').close();$('#info-dialog').addEventListener('click',e=>{if(e.target===$('#info-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#search').addEventListener('input',e=>{const query=e.target.value.trim().toLowerCase();$('#search-results').hidden=!query;if(!query)return;const found=vehicles.filter(v=>[v.id,v.shipment,v.plate,v.driver,v.company,'月台'+v.bay].some(s=>s.toLowerCase().includes(query)));const warehouses=['wh-03','临港','冷链仓'].some(s=>s.includes(query)||query.includes(s));$('#search-results').innerHTML=found.length||warehouses?found.map(v=>`<button data-result="${v.id}"><strong>${v.id}</strong><small>${v.company} · ${v.status}</small></button>`).join('')+(warehouses?'<button id="warehouse-result"><strong>WH-03 临港冷链仓</strong><small>3 / 6 月台作业中</small></button>':''):'<p>未找到匹配资产</p>';document.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{selectVehicle(b.dataset.result,true);$('#search-results').hidden=true;$('#search').value='';});$('#warehouse-result')?.addEventListener('click',()=>{resetView();dockDialog(1);$('#search-results').hidden=true;});});
document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();$('#search').focus();}if(e.key==='Escape'){$('#search-results').hidden=true;document.querySelectorAll('.popover').forEach(p=>p.hidden=true);$('#workspace').classList.remove('detail-open');}});
setInterval(()=>{$('#clock').textContent=timeString();$('#sync-time').textContent=timeString();},1000);
try{createScene();}catch(error){console.error('3D initialization failed',error);$('#loading')?.remove();$('#scene').innerHTML='<div class="fallback"><strong>3D 场景需要 WebGL 支持</strong><span>请使用支持硬件加速的浏览器。数据面板与运单查询仍可使用。</span><button onclick="location.reload()">重新加载</button></div>';}
