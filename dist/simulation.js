// Business simulation: every truck is a distinct trip, with one-way entry and exit.
export const DOCK_Z=-4.8, WAIT_Z=2.5, SENSOR_Z=5, ENTRY_Z=20, EXIT_Z=11;
export const LEFT_X=-46, RIGHT_X=46;
export const PHASE_NAMES={entering:'左侧入场',maneuvering:'倒车入位',approach:'接近月台',waiting:'等待开门',docking:'倒车停靠',loading:'装货中',departing:'装货完成',exiting:'右侧驶出',completed:'已离场'};
export const FORKLIFT_NAMES={pickup:'叉取货物',queued:'等候入库',transporting:'载货入库',waitingDoor:'等待开门',enteringWarehouse:'驶入仓库',deposit:'放下货物',backingOut:'空车退出',returning:'返回取货'};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function makeRoute(segments){
  const points=[];
  for(const segment of segments){
    if(segment.length===2){points.push(...segment.map(([x,z])=>({x,z})));continue;}
    for(let i=0;i<=48;i++){const t=i/48,u=1-t;points.push({x:u*u*u*segment[0][0]+3*u*u*t*segment[1][0]+3*u*t*t*segment[2][0]+t*t*t*segment[3][0],z:u*u*u*segment[0][1]+3*u*u*t*segment[1][1]+3*u*t*t*segment[2][1]+t*t*t*segment[3][1]});}
  }
  const clean=[];let length=0;
  for(const p of points){const previous=clean.at(-1);if(previous){const distance=Math.hypot(p.x-previous.x,p.z-previous.z);if(distance<1e-8)continue;length+=distance;}clean.push({...p,distance:length});}
  return {points:clean,length};
}
export function routePose(route,distance,reverse=false){
  const d=clamp(distance,0,route.length),points=route.points;
  let i=1;while(i<points.length-1&&points[i].distance<d)i++;
  const a=points[i-1],b=points[i],t=(d-a.distance)/(b.distance-a.distance);
  return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,yaw:Math.atan2((b.x-a.x)*(reverse?-1:1),(b.z-a.z)*(reverse?-1:1))};
}
const line=(a,b)=>makeRoute([[a,b]]);
export function actorsOverlap(a,b,margin=.45){
  const axes=[a.yaw,b.yaw].flatMap(yaw=>[{x:Math.sin(yaw),z:Math.cos(yaw)},{x:Math.cos(yaw),z:-Math.sin(yaw)}]);
  for(const axis of axes){
    const radius=actor=>Math.abs(axis.x*Math.sin(actor.yaw)+axis.z*Math.cos(actor.yaw))*(actor.length/2+margin/2)+Math.abs(axis.x*Math.cos(actor.yaw)-axis.z*Math.sin(actor.yaw))*(actor.width/2+margin/2);
    if(Math.abs((a.x-b.x)*axis.x+(a.z-b.z)*axis.z)>=radius(a)+radius(b))return false;
  }
  return true;
}
const door=opened=>({open:opened?1:0,target:opened?1:0,clearTime:0});
export function doorStatus(d){return d.open>=.999?'已开启':d.open<=.001?'已关闭':d.target?'开启中':'关闭中';}
export function dockStatus(state){return ({loading:'装货中',docking:'停靠中',waiting:'开门中',departing:'驶离中'})[state?.phase]??(state?'已预约':'空闲');}
function updateDoor(d,requested,dt){d.clearTime=requested?0:d.clearTime+dt;if(requested)d.target=1;else if(d.clearTime>=1.5)d.target=0;d.open=clamp(d.open+(d.target?1:-1)*dt/2.4,0,1);}
function record(sim,type,state){sim.events.unshift({type,id:state.id,time:sim.elapsed,bay:state.bay});sim.events.length=Math.min(12,sim.events.length);}
function phase(sim,v,name,route=null,reverse=false){v.phase=name;v.phaseTime=0;v.route=route;v.travel=0;v.reverse=reverse;record(sim,name,v);}
function truckState(metadata,dock,phaseName,loaded=0,x=LEFT_X){return {id:metadata.id,vehicle:{...metadata,bay:dock.bay},bay:dock.bay,x:phaseName==='loading'?dock.x:x,z:phaseName==='loading'?DOCK_Z:ENTRY_Z,yaw:phaseName==='loading'?0:Math.PI/2,phase:phaseName,phaseTime:0,loaded,capacity:8,loadClock:0,length:7,width:3.2,wheelAngle:0,velocity:0,route:phaseName==='entering'?line([x,ENTRY_Z],[dock.x+5.5,ENTRY_Z]):null,travel:0,reverse:false,arrived:phaseName==='loading'};}
export function createSimulation(templates){
  const sim={templates:templates.map(v=>({...v})),elapsed:0,fleet:[],completed:[],docks:[{bay:2,x:-8,door:door(true),vehicleId:null},{bay:1,x:0,door:door(true),vehicleId:null},{bay:3,x:8,door:door(false),vehicleId:null}],gates:{entry:door(false),exit:door(false)},receivingDoor:door(false),inventory:990,initialInventory:999,loadedTotal:9,receivedTotal:0,departed:0,stagingStock:24,nextArrival:6,nextSerial:2604,nextShipment:78473,events:[],forklifts:[]};
  for(let i=0;i<3;i++){const dock=sim.docks[i],v=truckState(templates[i],dock,i<2?'loading':'entering',i===0?6:i===1?3:0,-42);dock.vehicleId=v.id;sim.fleet.push(v);}
  sim.forklifts=[-25,-20,-15].map((x,index)=>({id:'FL-00'+(index+1),index,x,z:8,yaw:Math.PI,phase:'pickup',phaseTime:-index*1.5,loaded:false,lift:0,delivered:0,wheelAngle:0,velocity:0,length:3.6,width:1.45,wheelRadius:.28,route:null,travel:0,reverse:false,pickupX:x}));
  return sim;
}
function move(v,dt,speed,others){
  const distance=Math.min(v.route.length,v.travel+dt*speed),pose=routePose(v.route,distance,v.reverse);
  if(others.some(other=>other.id!==v.id&&actorsOverlap({...v,...pose},other)))return false;
  const traveled=distance-v.travel;Object.assign(v,pose);v.velocity=traveled/dt;v.wheelAngle+=traveled*(v.reverse?-1:1)/(v.wheelRadius??.47);v.travel=distance;
  return distance>=v.route.length-1e-7;
}
function tryArrival(sim){
  if(sim.elapsed<sim.nextArrival||sim.fleet.length>=6)return;
  const dock=sim.docks.find(d=>!d.vehicleId);
  if(!dock||sim.fleet.some(v=>v.phase==='entering'&&v.x<-30))return;
  const number=sim.nextSerial++,template=sim.templates[(number-2604)%sim.templates.length];
  const metadata={...template,id:'TRK-'+number,plate:'沪 C·'+number,shipment:'SHP-'+sim.nextShipment++,driver:['赵峰','李航','周凯'][(number-2604)%3]};
  const v=truckState(metadata,dock,'entering');dock.vehicleId=v.id;sim.fleet.push(v);sim.nextArrival=sim.elapsed+6;record(sim,'newArrival',v);
}
function truckStep(sim,v,dt){
  const dock=sim.docks.find(d=>d.bay===v.bay);v.phaseTime+=dt;v.velocity=0;
  const traffic=sim.fleet.filter(other=>other.phase!=='completed');
  switch(v.phase){
    case 'entering':{
      if(v.x>=-38&&v.x<-30&&sim.gates.entry.open<.999)break;
      if(move(v,dt,5,traffic))phase(sim,v,'maneuvering',makeRoute([[[dock.x+5.5,ENTRY_Z],[dock.x+1,ENTRY_Z],[dock.x,14],[dock.x,7.5]]]),true);
      break;
    }
    case 'maneuvering':{
      // Keep the exit lane free while a departing truck crosses this bay.
      if(traffic.some(other=>other.id!==v.id&&['departing','exiting'].includes(other.phase)&&Math.abs(other.x-dock.x)<13))break;
      if(move(v,dt,2.6,traffic))phase(sim,v,'approach',line([dock.x,7.5],[dock.x,WAIT_Z]),true);
      break;
    }
    case 'approach':if(move(v,dt,2.4,traffic))phase(sim,v,'waiting');break;
    case 'waiting':if(dock.door.open>=.999)phase(sim,v,'docking',line([dock.x,WAIT_Z],[dock.x,DOCK_Z]),true);break;
    case 'docking':if(dock.door.open>=.999&&move(v,dt,1.8,traffic)){v.arrived=true;phase(sim,v,'loading');}break;
    case 'loading':
      if(dock.door.open<.999)break;
      v.loadClock+=dt;
      if(v.loadClock>=1.3&&v.loaded<v.capacity&&sim.inventory>0){v.loadClock-=1.3;v.loaded++;sim.inventory--;sim.loadedTotal++;record(sim,'palletLoaded',v);}
      if(v.loaded===v.capacity)phase(sim,v,'departing',line([dock.x,DOCK_Z],[dock.x,6]));
      break;
    case 'departing':if(move(v,dt,3.6,traffic)){dock.vehicleId=null;phase(sim,v,'exiting',makeRoute([[[dock.x,6],[dock.x,9],[dock.x+2,EXIT_Z],[dock.x+5,EXIT_Z]],[[dock.x+5,EXIT_Z],[RIGHT_X,EXIT_Z]]]));}break;
    case 'exiting':
      if(v.x>=31&&v.x<38&&sim.gates.exit.open<.999)break;
      if(move(v,dt,5.5,traffic)){v.phase='completed';sim.departed++;sim.completed.unshift({...v,vehicle:{...v.vehicle}});sim.completed.length=Math.min(20,sim.completed.length);record(sim,'completed',v);}
      break;
  }
}
function forkliftStep(sim,f,dt){
  f.phaseTime+=dt;f.velocity=0;
  const holder=sim.forklifts.find(other=>other.id!==f.id&&(['transporting','waitingDoor','enteringWarehouse','deposit','backingOut'].includes(other.phase)||(other.phase==='returning'&&other.travel<3)));
  switch(f.phase){
    case 'pickup':
      if(f.phaseTime>=1&&sim.stagingStock>0&&!f.loaded){f.loaded=true;sim.stagingStock--;}
      f.lift=f.loaded?clamp((f.phaseTime-1)*.9,0,.55):0;
      if(f.phaseTime>=1.8&&f.loaded)phase(sim,f,'queued');
      break;
    case 'queued':
      if(!holder)phase(sim,f,'transporting',makeRoute([[[f.pickupX,8],[f.pickupX,5],[-25,5],[-25,2]]]));
      break;
    case 'transporting':if(move(f,dt,2,sim.forklifts))phase(sim,f,'waitingDoor');break;
    case 'waitingDoor':if(sim.receivingDoor.open>=.999)phase(sim,f,'enteringWarehouse',line([-25,2],[-25,-3]));break;
    case 'enteringWarehouse':if(sim.receivingDoor.open>=.999&&move(f,dt,1.6,sim.forklifts))phase(sim,f,'deposit');break;
    case 'deposit':
      f.lift=Math.max(0,.55-f.phaseTime*.5);
      if(f.phaseTime>=1.3){f.loaded=false;f.delivered++;sim.inventory++;sim.receivedTotal++;phase(sim,f,'backingOut',line([-25,-3],[-25,2]),true);}
      break;
    case 'backingOut':if(move(f,dt,1.8,sim.forklifts))phase(sim,f,'returning',makeRoute([[[-25,2],[-28,2],[-31,2],[-31,5]],[[-31,5],[-31,10]],[[-31,10],[-31,12],[-30,12],[-29,12]],[[-29,12],[f.pickupX-3,12]],[[f.pickupX-3,12],[f.pickupX,12],[f.pickupX,11],[f.pickupX,8]]]));break;
    case 'returning':if(move(f,dt,2.3,sim.forklifts)){f.yaw=Math.PI;phase(sim,f,'pickup');}break;
  }
}
export function stepSimulation(sim,seconds){
  if(!Number.isFinite(seconds)||seconds<=0)return;
  let remaining=seconds;
  while(remaining>1e-8){const dt=Math.min(.04,remaining);remaining-=dt;sim.elapsed+=dt;
    tryArrival(sim);
    updateDoor(sim.gates.entry,sim.fleet.some(v=>v.phase==='entering'&&v.x>-43&&v.x<-27),dt);
    updateDoor(sim.gates.exit,sim.fleet.some(v=>v.phase==='exiting'&&v.x>26&&v.x<42),dt);
    for(const dock of sim.docks){const assigned=sim.fleet.find(v=>v.id===dock.vehicleId);updateDoor(dock.door,!!assigned&&(['waiting','docking','loading'].includes(assigned.phase)||(['approach','departing'].includes(assigned.phase)&&assigned.z<=SENSOR_Z)),dt);}
    updateDoor(sim.receivingDoor,sim.forklifts.some(f=>['waitingDoor','enteringWarehouse','deposit','backingOut'].includes(f.phase)||(f.phase==='transporting'&&Math.hypot(f.x+25,f.z+1)<6)||(f.phase==='returning'&&f.travel<3)),dt);
    // Departures get merge priority, then existing traffic, then new arrivals.
    const ordered=[...sim.fleet].sort((a,b)=>Number(['departing','exiting'].includes(b.phase))-Number(['departing','exiting'].includes(a.phase)));
    for(const v of ordered)truckStep(sim,v,dt);
    sim.fleet=sim.fleet.filter(v=>v.phase!=='completed');
    for(const f of sim.forklifts)forkliftStep(sim,f,dt);
    if(sim.stagingStock<4){sim.stagingStock+=12;record(sim,'stagingReplenished',{id:'待入库批次'});}
  }
}
