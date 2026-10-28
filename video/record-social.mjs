import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE??'/home/robbie/Projects/softie-webgpu/node_modules/playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'video/output');mkdirSync(output,{recursive:true});
const narration=JSON.parse(readFileSync(path.join(output,'narration-timeline.json'),'utf8'));
const FPS=30,frameCount=Math.round(FPS*narration.duration),DURATION=frameCount/FPS;
const preview=process.argv.includes('--preview');
const css=`
*{animation:none!important;transition:none!important;scroll-behavior:auto!important}
html,body{width:720px;height:1280px;margin:0;overflow:hidden!important;background:#edf2fa;font-family:'Noto Sans CJK SC','Microsoft Yahei',sans-serif}
.topbar,.sidebar,.scene-heading,.scene-status,.flow-legend,.view-controls,.scene-caption,.simulation-bar,.popover,#toast{display:none!important}
.workspace{margin:0!important;position:absolute!important;inset:0!important;height:1280px!important;min-height:0!important;width:720px!important}
#scene,#labels{inset:0!important;height:1280px!important;width:720px!important}
#scene canvas{width:720px!important;height:1280px!important}
#labels .scene-label{font-size:10px!important;padding:5px 8px!important}
#labels .scene-label.selected{font-size:11px!important}
#labels .scene-label.warehouse{font-size:10px!important}
#labels .scene-label small{font-size:8px!important}
.chart-rail{display:contents!important}
.chart-rail>*{display:none!important}
.chart-rail .metrics{position:absolute!important;display:grid!important;left:40px!important;right:40px!important;bottom:135px!important;top:auto!important;width:640px!important;grid-template-columns:repeat(4,1fr)!important;gap:9px!important;overflow:visible!important;z-index:20}
.chart-rail .metrics .metric{height:85px!important;padding:13px 16px!important;box-shadow:0 8px 25px #537da00b!important;background:#ffffffef!important;border-color:#fff!important}
.chart-rail .metrics .metric:nth-child(n+5){display:none!important}
.metric-title{font-size:11px!important;color:#8297b2!important}
.metric-value{font-size:30px!important;gap:6px!important}
.metric-value small{font-size:9px!important}
.kpi-accent{top:27px!important;height:26px!important;right:12px!important;width:2px!important}
#video-header{position:absolute;inset:0 0 auto;height:315px;z-index:30;padding:65px 40px 0;background:linear-gradient(#edf2fafb 0%,#edf2fae8 70%,#edf2fa00 100%);pointer-events:none}
.video-brand{display:flex;align-items:center;gap:9px;color:#3a69a4;font-size:19px;letter-spacing:.5px;font-weight:500}
.video-brand svg{width:26px;height:29px;stroke:#4e80e8;fill:#e1ebff;stroke-width:1.6}
.video-brand small{margin-left:auto;font-size:10px;letter-spacing:1px;color:#9eb0c7;background:#ffffff90;padding:5px 9px;border-radius:4px}
.video-section{font-size:11px;letter-spacing:2.7px;color:#8499b5;margin-top:23px;margin-bottom:12px}
#video-title{display:block!important;max-width:none!important;width:640px;font-size:41px;line-height:1.22;font-weight:600;letter-spacing:1px;color:#314e73;margin:0;white-space:pre-line}
#video-subtitle{font-size:17px;letter-spacing:1px;color:#8a9fbb;margin-top:15px;white-space:nowrap}
#video-footer{position:absolute;left:40px;right:40px;bottom:239px;z-index:30;pointer-events:none}
#video-caption{font-size:19px;color:#617c9e;letter-spacing:.6px;line-height:1.6;background:#ffffffdc;padding:11px 16px;border-radius:9px;border:1px solid #fff;box-shadow:0 7px 25px #55738f09;text-align:center}
.video-bottom{position:absolute;left:40px;right:40px;bottom:77px;z-index:30;display:flex;justify-content:space-between;align-items:center;color:#9dacc0;font-size:10px;letter-spacing:1.3px}
.video-bottom i{display:inline-block;width:5px;height:5px;background:#6cb59b;border-radius:50%;margin-right:5px}
.video-progress{position:absolute;left:40px;right:40px;bottom:110px;height:2px;background:#dce5f0;z-index:31;border-radius:3px}
#video-progress-fill{height:100%;background:#7da3e7;border-radius:3px}
body[data-shot='charts'] .chart-rail .metrics{bottom:135px!important}
body[data-shot='charts'] .left-stack{display:grid!important;position:absolute!important;left:40px!important;right:40px!important;top:667px!important;width:640px!important;grid-template-columns:1fr 1fr!important;gap:12px!important;z-index:25}
body[data-shot='charts'] .left-stack>.chart-panel{height:210px!important;padding:17px 18px!important}
body[data-shot='charts'] .inventory-plot{height:155px!important}
body[data-shot='charts'] .chart-heading h2{font-size:13px!important}
body[data-shot='charts'] .chart-heading small{font-size:9px!important}
body[data-shot='charts'] .chart-rail .bottom-panels{display:grid!important;position:absolute!important;left:40px!important;right:40px!important;top:889px!important;width:640px!important;height:146px!important;grid-template-columns:1fr 1fr!important;gap:12px!important;z-index:25}
body[data-shot='charts'] .bottom-panels>.chart-panel{height:146px!important;padding:13px 16px!important}
body[data-shot='charts'] .bottom-panels>.asset-panel{display:none!important}
body[data-shot='charts'] .throughput-plot{height:102px!important}
body[data-shot='charts'] .forklift-bars{height:99px!important}
body[data-shot='charts'] .forklift-viz{height:97px!important}
body[data-shot='charts'] #video-footer{display:block;top:333px;bottom:auto}
body[data-shot='charts'] #video-caption{font-size:18px;min-height:53px;background:#ffffffea}
body[data-chart-focus='inventory'] .left-stack>.chart-panel:first-child,
body[data-chart-focus='fleet'] .left-stack>.chart-panel:nth-child(2),
body[data-chart-focus='throughput'] .bottom-panels>.chart-panel:not(.asset-panel){outline:2px solid #8bb0ed!important;box-shadow:0 8px 24px #6e94d527!important}
`;
const harness=`
window.__social={
  time:0,
  set(simTime,view,preferred){
    if(simTime<this.time-0.001)throw new Error('Recording timeline must move forward');
    stepSimulation(simulation,Math.max(0,simTime-this.time));this.time=simTime;trackTelemetry(telemetry,simulation);simSeconds=simulation.elapsed;
    const actor=simulation.fleet.find(v=>v.id===preferred);if(actor)selected=actor.vehicle;
    applySimulationModels();syncSimulationUI();controls.enableDamping=false;
    controls.target.set(view.x,0,view.z);camera.position.set(view.x+Math.sin(view.angle)*68,43,view.z+Math.cos(view.angle)*68);camera.zoom=view.zoom;camera.updateProjectionMatrix();controls.update();camera.updateMatrixWorld();
    const mesh=truckMeshes.find(m=>m.userData.vehicle===selected.id);selectionRing.position.set(mesh.position.x,.61,mesh.position.z);selectionRing.material.opacity=.55;
    marker.position.set(simulation.docks.find(d=>d.bay===selected.bay).x,.7,DOCK_Z);
    for(const label of sceneLabels){if(label.vehicle){const m=truckMeshes.find(m=>m.userData.vehicle===label.vehicle);label.position.set(m.position.x,5.1,m.position.z);}if(label.forkliftId){const m=forkliftMeshes.get(label.forkliftId);label.position.set(m.position.x,3.8,m.position.z);}const p=label.position.clone().project(camera);label.element.style.left=(p.x*.5+.5)*renderer.domElement.clientWidth+'px';label.element.style.top=(-p.y*.5+.5)*renderer.domElement.clientHeight+'px';label.element.style.display=p.z<1&&p.z>-1?'':'none';}
    renderer.render(scene,camera);
    return {time:simulation.elapsed,departed:simulation.departed,received:simulation.receivedTotal,inventory:simulation.inventory,vehicle:selected.id,phase:stateFor(selected).phase,forks:simulation.forklifts.map(f=>({id:f.id,phase:f.phase,loaded:f.loaded}))};
  }
};
`;
const shots=[
 {start:0,end:3,simStart:0,simEnd:4,key:'intro',tag:'WARETRACK / DIGITAL TWIN',title:'让物流园区\n动起来',sub:'智慧物流 · 3D 数字孪生',caption:'车辆、仓库门、叉车，实时联动',view:{x:0,z:7,zoom:1.05,angle:.72},actor:'TRK-2148'},
 {start:3,end:8,simStart:4,simEnd:14,key:'entry',tag:'01 / ONE-WAY TRAFFIC',title:'新车入场\n开启运输任务',sub:'左侧入场 · 独立车牌 · 独立运单',caption:'车辆沿入场车道驶入，前往装货月台',view:{x:-24,z:14,zoom:1.65,angle:.70},actor:'TRK-2604'},
 {start:8,end:15,simStart:14,simEnd:38,key:'loading',tag:'02 / DOCK INTERLOCK',title:'靠台装货\n仓库门自动联动',sub:'开门到位 → 停靠 → 逐托盘装货',caption:'装满 8 托盘，才允许车辆离场',view:{x:4,z:-2,zoom:1.75,angle:.75},actor:'TRK-2603'},
 {start:15,end:21,simStart:38,simEnd:50,key:'exit',tag:'03 / OUTBOUND DELIVERY',title:'满载驶出\n完成一次配送出库',sub:'右侧离场 · 道闸放行 · 新车接替',caption:'驶离月台后，沿出场车道从右侧离开',view:{x:26,z:12,zoom:1.75,angle:.72},actor:'TRK-2603'},
 {start:21,end:29,simStart:50,simEnd:66,key:'forklift',tag:'04 / MATERIAL FLOW',title:'叉车搬运\n让货物真正流动',sub:'叉起托盘 → 载货入库 → 空车返回',caption:'载货进入仓库，放下货物后空车退出',view:{x:-24,z:2,zoom:2.8,angle:.38},actor:'TRK-2604'},
 {start:29,end:32,simStart:66,simEnd:94,key:'charts',tag:'05 / LIVE TELEMETRY',title:'实时图表\n看见每一次流转',sub:'库存 · 车辆 · 货物流量 · 叉车吞吐',caption:'数据随入库与装车自动更新',view:{x:0,z:6,zoom:.95,angle:.72},actor:'TRK-2606'},
 {start:32,end:35,simStart:94,simEnd:98,key:'outro',tag:'WARETRACK / LOGISTICS SIMULATION',title:'智慧物流\n数字孪生',sub:'从 3D 场景，到完整动态流程',caption:'左侧进场，装货后右侧离场',view:{x:0,z:7,zoom:1.1,angle:.77},actor:'TRK-2609'}
].map(shot=>({...shot,...narration.segments.find(s=>s.key===shot.key)}));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
let encoder;
try{
 const context=await browser.newContext({viewport:{width:720,height:1280},deviceScaleFactor:1.5});const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};window.setInterval=()=>0;});
 await page.route('**/app.js*',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(path.join(root,'dist/app.js'),'utf8')+'\n'+harness}));
 await page.goto(process.env.RECORD_URL??'http://127.0.0.1:8081/');await page.waitForFunction(()=>!!window.__social);await page.addStyleTag({content:css});await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend',`<div id="video-header"><div class="video-brand"><svg viewBox="0 0 24 24"><path d="m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9"/></svg><span>WareTrack</span><small>模拟演示</small></div><div class="video-section" id="video-tag"></div><h1 id="video-title"></h1><div id="video-subtitle"></div></div><div id="video-footer"><div id="video-caption"></div></div><div class="video-progress"><div id="video-progress-fill"></div></div><div class="video-bottom"><span><i></i>3D DIGITAL TWIN</span><span>动态模拟 · 加速演示</span></div>`);});
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
 async function frame(t){
  const shot=shots.find(s=>t>=s.start&&t<s.end)??shots.at(-1),idx=shots.indexOf(shot),u=(t-shot.start)/(shot.end-shot.start);
  const elapsed=shot.simStart+(shot.simEnd-shot.simStart)*u;
  const previous=idx>0?shots[idx-1].view:shot.view,blend=Math.min(1,(t-shot.start)/.85),ease=blend*blend*(3-2*blend);
  const view=Object.fromEntries(Object.keys(shot.view).map(k=>[k,previous[k]+(shot.view[k]-previous[k])*ease]));view.angle+=(u-.5)*.035;
  const cue=narration.cues.filter(c=>c.start<=t&&c.start>=shot.start).at(-1);
  const state=await page.evaluate(({elapsed,view,actor,shot,t,duration,cue})=>{document.body.dataset.shot=shot.key;document.body.dataset.chartFocus=cue?.focus??'overview';document.querySelector('#video-tag').textContent=shot.tag;document.querySelector('#video-title').textContent=shot.title;document.querySelector('#video-subtitle').textContent=shot.sub;document.querySelector('#video-caption').textContent=cue?.text??shot.caption;document.querySelector('#video-progress-fill').style.width=(t/duration*100)+'%';return window.__social.set(elapsed,view,actor);},{elapsed,view,actor:shot.actor,shot,t,duration:DURATION,cue});
  const screenshot=await page.screenshot({type:'jpeg',quality:94,animations:'disabled'});return {screenshot,state};
 }
 if(preview){for(const t of [1,8,19,26,34,44,48,52,60]){const f=await frame(t);writeFileSync(path.join(output,`preview-v2-${t}.jpg`),f.screenshot);console.log(JSON.stringify({preview:t,...f.state}));}writeFileSync(path.join(output,'storyboard-v2.json'),JSON.stringify(shots,null,2));}
 else{
  const destination=path.join(output,'waretrack-social-vertical-v2-picture.mp4');
  encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(FPS),'-i','pipe:0','-an','-vf','scale=in_range=full:out_range=tv','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-movflags','+faststart',destination],{stdio:['pipe','ignore','pipe']});
  let encoderLog='';encoder.stderr.on('data',data=>encoderLog+=data.toString());encoder.stdin.on('error',()=>{});
  const finished=once(encoder,'close');const evidence=[];
  for(let i=0;i<frameCount;i++){const t=i/FPS,f=await frame(t);if(!encoder.stdin.write(f.screenshot))await once(encoder.stdin,'drain');if(i%180===0){console.log(JSON.stringify({progress:Math.round(i/frameCount*100),frame:i,...f.state}));evidence.push({frame:i,videoTime:t,...f.state});}if(i===45)writeFileSync(path.join(output,'waretrack-cover-v2.jpg'),f.screenshot);}
  encoder.stdin.end();const [code]=await finished;if(code!==0)throw new Error('FFmpeg failed: '+encoderLog);if(errors.length)throw new Error(errors.join('\n'));
  writeFileSync(path.join(output,'recording-evidence-v2.json'),JSON.stringify({width:1080,height:1920,fps:FPS,duration:DURATION,shots,evidence},null,2));
  const finalVideo=path.join(output,'waretrack-social-vertical-narrated.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',destination,'-i',path.join(output,'waretrack-narration.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:a','aac','-b:a','192k','-ar','48000','-t',String(DURATION),'-movflags','+faststart','-metadata','title=WareTrack 智慧物流数字孪生','-metadata:s:a:0','language=zho',finalVideo]);
  console.log(JSON.stringify({done:true,path:finalVideo,frames:frameCount,width:1080,height:1920,fps:FPS,duration:DURATION,chartDuration:shots.find(s=>s.key==='charts').end-shots.find(s=>s.key==='charts').start,narration:narration.voice}));
 }
 if(errors.length)throw new Error(errors.join('\n'));
}finally{if(encoder&&!encoder.killed&&encoder.exitCode===null)encoder.kill('SIGTERM');await browser.close();}
