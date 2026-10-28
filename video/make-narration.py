"""Generate Mandarin narration locally and derive the shot/subtitle timeline from its audio."""
from pathlib import Path
import json, math, os
import numpy as np
import soundfile as sf
import onnxruntime as ort
from misaki import zh
from kokoro_onnx import Kokoro

root=Path(__file__).resolve().parent
out=root/'output'
clips=out/'narration-clips'
clips.mkdir(parents=True, exist_ok=True)
models=root/'.models'
config=json.loads((models/'config.json').read_text())
options=ort.SessionOptions()
options.intra_op_num_threads=4
options.inter_op_num_threads=1
session=ort.InferenceSession(str(models/'kokoro-v1.1-zh.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
k=Kokoro.from_session(session,str(models/'voices-v1.1-zh.bin'))
k.tokenizer.vocab=config['vocab']
# This model expects a float speed input; adapt the older runtime wrapper.
class FloatSpeedSession:
    def get_inputs(self): return session.get_inputs()
    def run(self, outputs, inputs):
        inputs['speed']=np.asarray(inputs['speed'],dtype=np.float32)
        return session.run(outputs, inputs)
k.sess=FloatSpeedSession()
g2p=zh.ZHG2P(version='1.1')
voice=os.environ.get('NARRATOR_VOICE','zm_010')
spec=json.loads((root/'narration.json').read_text())
segments=[]
cues=[]
parts=[]
time=0
sr=24000
for shot in spec:
    chunks=[]
    local=[]
    at=.35
    chunks.append(np.zeros(round(at*sr),dtype=np.float32))
    for index,text in enumerate(shot['sentences']):
        filename=clips/f"{shot['key']}-{index}-{voice}.wav"
        if filename.exists():
            audio,rate=sf.read(filename,dtype='float32')
        else:
            phonemes,_=g2p(text)
            audio,rate=k.create(phonemes,voice=voice,speed=1.02,is_phonemes=True)
            # Keep breath space while removing excessive leading/trailing silence.
            nz=np.where(np.abs(audio)>.003)[0]
            if len(nz): audio=audio[max(0,nz[0]-round(.04*rate)):min(len(audio),nz[-1]+round(.12*rate))]
            sf.write(filename,audio,rate)
        assert rate==sr and len(audio)>sr*.3
        duration=len(audio)/sr
        local.append({'start':round(time+at,4),'end':round(time+at+duration,4),'text':text,'focus': ['overview','inventory','fleet','throughput'][index] if shot['key']=='charts' else None})
        chunks.extend([audio,np.zeros(round(.18*sr),dtype=np.float32)])
        at+=duration+.18
        print(json.dumps({'shot':shot['key'],'text':text,'duration':round(duration,3)},ensure_ascii=False),flush=True)
    duration=math.ceil(max(shot['minimum'],at+.35)*30)/30
    segment=np.concatenate(chunks)
    segment=np.pad(segment,(0,round(duration*sr)-len(segment)))
    parts.append(segment)
    segments.append({'key':shot['key'],'start':round(time,4),'end':round(time+duration,4)})
    cues.extend(local)
    time+=duration
samples=np.concatenate(parts)
# A single common gain preserves vocal dynamics across sentences.
peak=float(np.abs(samples).max())
if peak: samples*=.85/peak
sf.write(out/'waretrack-narration.wav',samples,sr,subtype='PCM_16')
manifest={'duration':round(time,4),'voice':voice,'segments':segments,'cues':cues}
(out/'narration-timeline.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
def stamp(t):
    ms=round(t*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
(out/'waretrack-narration.srt').write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(cues))+'\n',encoding='utf-8')
(out/'旁白稿.txt').write_text('\n\n'.join(''.join(s['sentences']) for s in spec),encoding='utf-8')
print(json.dumps({'done':True,'duration':time,'voice':voice,'segments':segments},ensure_ascii=False),flush=True)
