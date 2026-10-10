import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import * as RealThree from '../dist/vendor/three.module.min.js';
import * as Simulation from '../dist/simulation.js';
import * as Charts from '../dist/charts.js';

// Exercise business behavior and construct real Three.js geometry without a browser.
// This does not replace visual browser QA or verify GPU rendering.
const root = new URL('../', import.meta.url);
const html=readFileSync(new URL('dist/index.html',root),'utf8');
const source=readFileSync(new URL('dist/app.js',root),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'HTML IDs must be unique');
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
  if(match[1].startsWith('http')||match[1]==='./')continue;
  assert.ok(existsSync(new URL('dist/'+match[1].split('?')[0],root)),`Missing asset: ${match[1]}`);
}
const nodes=new Map();
function element(){return {innerHTML:'',textContent:'',value:'',checked:true,hidden:true,style:{},dataset:{},clientWidth:1364,clientHeight:922,children:[],classList:{add(){},remove(){},toggle(){}},append(e){this.children.push(e);},appendChild(e){this.children.push(e);},remove(){},setAttribute(){},addEventListener(type,fn){this['on'+type]=fn;},getBoundingClientRect(){return {left:0,top:0,width:1364,height:922,right:1364,bottom:922};},getContext(){return {fillRect(){},fillText(){}};},showModal(){this.open=true;},close(){this.open=false;}};}
const document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);},querySelectorAll(){return [];},createElement(){return element();},addEventListener(){},activeElement:{tagName:'BODY'}};
class Renderer{constructor(){this.domElement=element();this.shadowMap={};}setSize(){}setPixelRatio(){}render(){}}
class Controls{constructor(){this.target=new RealThree.Vector3();}update(){}}
let milliseconds=0;
const context=vm.createContext({console,document,...Simulation,...Charts,THREE:{...RealThree,WebGLRenderer:Renderer},OrbitControls:Controls,performance:{now:()=>milliseconds},requestAnimationFrame(){},ResizeObserver:class{observe(){}},devicePixelRatio:1,innerWidth:1440,setInterval(){},setTimeout(){},clearTimeout(){}});
vm.runInContext(source.replace(/^import .*;\n/gm,'')+'\nglobalThis.app={get telemetry(){return telemetry;},get vehicles(){return vehicles;},get scene(){return scene;},get camera(){return camera;},get selected(){return selected;},get simulation(){return simulation;},get doors(){return dockMeshes;},get forklifts(){return forkliftMeshes;},get ready(){return sceneReady;},get running(){return running;},get meshes(){return truckMeshes;},selectVehicle,setTab,animate,resetSimulation};',context);
const {app}=context;
assert.ok(app.ready,'3D scene must construct successfully');
assert.equal(app.meshes.length,3);
assert.equal(app.selected.id,'TRK-2148');
let geometryCount=0;app.scene.traverse(o=>{if(o.isMesh){geometryCount++;const a=o.geometry.attributes.position;for(let i=0;i<a.array.length;i++)assert.ok(Number.isFinite(a.array[i]),'Geometry positions must be finite');}});
assert.ok(geometryCount>300,'Detailed scene must contain buildings and logistics assets');
app.selectVehicle('TRK-2148');assert.match(nodes.get('#detail-card').innerHTML,/装载率/);assert.doesNotMatch(nodes.get('#detail-card').innerHTML,/客户|离场条件|运输线路/);
app.selectVehicle('TRK-2603');app.setTab('docks');assert.match(nodes.get('#asset-list').innerHTML,/已预约/);
assert.ok(app.running,'Simulation must start automatically');
const start=app.meshes.map(m=>[m.position.x,m.position.z]);
for(let i=0;i<30;i++){milliseconds+=100;app.animate();}
assert.notEqual(app.meshes[0].position.z,start[0][1]);assert.notEqual(app.meshes[2].position.x,start[2][0]);
nodes.get('#simulation-toggle').onclick();assert.equal(app.running,false);
const snapshot=JSON.stringify({fleet:app.simulation.fleet,doors:app.simulation.docks,forks:app.simulation.forklifts,inventory:app.simulation.inventory});
milliseconds+=100;app.animate();assert.equal(JSON.stringify({fleet:app.simulation.fleet,doors:app.simulation.docks,forks:app.simulation.forklifts,inventory:app.simulation.inventory}),snapshot,'Pause must freeze traffic, forklifts, doors and cargo');
nodes.get('#speed-button').onclick();nodes.get('#speed-button').onclick();assert.equal(nodes.get('#speed-button').textContent,'4×');nodes.get('#simulation-toggle').onclick();
for(let i=0;i<200;i++){milliseconds+=100;app.animate();assert.equal(app.meshes.length,app.simulation.fleet.length,'Exited models must be removed and new models created');}
assert.ok(app.simulation.departed>=4);assert.ok(app.simulation.fleet.some(v=>!['TRK-2148','TRK-2471','TRK-2603'].includes(v.id)));
assert.ok(app.simulation.receivedTotal>0);assert.equal(app.forklifts.size,3);assert.ok(app.selected&&app.simulation.fleet.some(v=>v.id===app.selected.id),'Selection must switch to an active truck after departure');
app.resetSimulation();assert.equal(app.simulation.elapsed,0);assert.equal(app.meshes.length,3);assert.equal(app.meshes[2].position.x,-42);assert.equal(app.vehicles[2].status,'左侧入场');assert.equal(app.simulation.inventory,990);assert.equal(app.doors.get(3).shutter.scale.y,1);assert.equal(app.doors.get(0).shutter.scale.y,1);

// Observe every physical step through many distinct trips, not a replay of one truck.
const sim=Simulation.createSimulation(app.vehicles),seen=new Set(),finished=new Set();
const phases=new Set(),forkPhases=new Set();let previous=new Map();
for(let i=0;i<5000;i++){
  Simulation.stepSimulation(sim,.04);
  assert.equal(sim.inventory,sim.initialInventory+sim.receivedTotal-sim.loadedTotal,'Cargo accounting must balance');
  assert.ok(sim.inventory>=0);assert.equal(sim.forklifts.reduce((sum,f)=>sum+f.delivered,0),sim.receivedTotal);
  for(const v of sim.fleet){
    assert.ok(!finished.has(v.id),'A completed vehicle must never reappear');seen.add(v.id);phases.add(v.phase);
    const old=previous.get(v.id);if(old)assert.ok(Math.hypot(v.x-old.x,v.z-old.z)<.3,'Vehicles must not teleport between entry and exit');
    const gate=sim.docks.find(d=>d.bay===v.bay).door;
    if(v.phase==='loading'||v.phase==='docking')assert.ok(gate.open>=.999,'Loading and docking require a fully open door');
    if(['departing','exiting'].includes(v.phase))assert.equal(v.loaded,v.capacity,'Only fully loaded vehicles may leave');
    if(v.phase==='entering'){assert.ok(Math.abs(v.z-Simulation.ENTRY_Z)<1e-6);if(old)assert.ok(v.x>=old.x,'Incoming traffic must move from left to right');}
    if(v.phase==='exiting'&&v.z>=Simulation.EXIT_Z-.01&&old)assert.ok(v.x>=old.x,'Exit traffic must move to the right');
  }
  for(let a=0;a<sim.fleet.length;a++)for(let b=a+1;b<sim.fleet.length;b++)assert.ok(!Simulation.actorsOverlap(sim.fleet[a],sim.fleet[b],0),'Truck bodies must not overlap');
  for(const trip of sim.completed){finished.add(trip.id);assert.equal(trip.loaded,8);assert.ok(trip.x>=Simulation.RIGHT_X-.01,'Vehicles must complete outside the right boundary');}
  for(const f of sim.forklifts){forkPhases.add(f.phase);if(['transporting','waitingDoor','enteringWarehouse','deposit'].includes(f.phase))assert.ok(f.loaded,'Inbound forklift must visibly carry cargo');if(['backingOut','returning'].includes(f.phase))assert.equal(f.loaded,false,'Forklift must return empty after depositing cargo');if(['enteringWarehouse','deposit','backingOut'].includes(f.phase))assert.ok(sim.receivingDoor.open>=.999,'Forklift must not pass through a closed warehouse door');}
  assert.ok(sim.forklifts.filter(f=>['transporting','waitingDoor','enteringWarehouse','deposit','backingOut'].includes(f.phase)).length<=1,'Inbound door must admit one forklift at a time');
  previous=new Map(sim.fleet.map(v=>[v.id,{x:v.x,z:v.z}]));
}
assert.ok(sim.departed>=12&&seen.size>=15,'Continuous traffic must create and complete distinct vehicle trips');assert.ok(sim.forklifts.every(f=>f.delivered>=3),'Every forklift must deliver cargo');assert.equal(phases.size,8);assert.equal(forkPhases.size,8);
const interlock=Simulation.createSimulation(app.vehicles),waiting=interlock.fleet[2],dock=interlock.docks[2];waiting.phase='waiting';waiting.x=dock.x;waiting.z=Simulation.WAIT_Z;dock.door.open=0;
Simulation.stepSimulation(interlock,.1);assert.equal(waiting.phase,'waiting');assert.equal(waiting.z,Simulation.WAIT_Z);Simulation.stepSimulation(interlock,3);assert.equal(waiting.phase,'docking');assert.equal(dock.door.open,1);
const depleted=Simulation.createSimulation(app.vehicles);depleted.inventory=0;depleted.initialInventory=9;
for(let i=0;i<2500;i++){Simulation.stepSimulation(depleted,.04);assert.ok(depleted.inventory>=0);for(const truck of depleted.fleet)if(['departing','exiting'].includes(truck.phase))assert.equal(truck.loaded,8);}
assert.ok(depleted.receivedTotal>0&&depleted.departed>0,'Forklift replenishment must unblock loading when the warehouse starts empty');
// Chart data comes from observed simulation counters and resets with the simulation.
const chartSim=Simulation.createSimulation(app.vehicles),log=Charts.createTelemetry(chartSim),baseLoaded=chartSim.loadedTotal;
for(let i=0;i<120;i++){Simulation.stepSimulation(chartSim,.5);Charts.trackTelemetry(log,chartSim);}
assert.equal(log.history.at(-1).inventory,chartSim.inventory);
assert.equal(log.bins.reduce((sum,b)=>sum+b.received,0),chartSim.receivedTotal);
assert.equal(log.bins.reduce((sum,b)=>sum+b.loaded,0),chartSim.loadedTotal-baseLoaded);
assert.equal(Charts.fleetGroups(chartSim).reduce((sum,g)=>sum+g.value,0),chartSim.fleet.length);
for(const dock of chartSim.docks){assert.ok(Charts.utilization(log,chartSim,dock)>=0&&Charts.utilization(log,chartSim,dock)<=100);}
assert.doesNotMatch(Charts.inventoryChart(log,chartSim.inventory)+Charts.throughputChart(log),/NaN|undefined|Infinity/);
assert.ok(log.history.length<=61&&log.bins.length<=12);
assert.equal(app.telemetry.history.length,1,'Reset must clear chart history');
assert.match(nodes.get('#inventory-chart').innerHTML,/库存趋势/);assert.match(nodes.get('#throughput-chart').innerHTML,/入库与装车/);
nodes.get('#search').oninput({target:{value:'SHP-78472'}});assert.match(nodes.get('#search-results').innerHTML,/TRK-2603/);
nodes.get('#search').oninput({target:{value:'不存在的资产'}});assert.match(nodes.get('#search-results').innerHTML,/未找到匹配资产/);
nodes.get('#open-shipment').onclick();assert.ok(nodes.get('#info-dialog').open);assert.match(nodes.get('#dialog-content').innerHTML,/−18.2°C/);
nodes.get('#show-route').onchange({target:{checked:false}});nodes.get('#show-trees').onchange({target:{checked:false}});
const initialZoom=app.camera.zoom;nodes.get('#zoom-in').onclick();assert.ok(app.camera.zoom>initialZoom);nodes.get('#reset-view').onclick();assert.equal(app.camera.zoom,1);
console.log(JSON.stringify({passed:true,geometryCount,departedTrips:sim.departed,inboundPallets:sim.receivedTotal,checks:['3D geometry and assets','unique vehicle trips','left entry and right exit','smooth continuous movement','truck collision avoidance','full-load departure rule','door safety interlock','forklift cargo pickup and deposit','empty forklift return','single forklift admission','inventory conservation','dynamic actor cleanup','selection after departure','pause and reset','chart source consistency','throughput bucket accounting','chart history reset','search and camera controls'],limits:'This command does not verify GPU rendering; browser QA is run separately.'},null,2));
