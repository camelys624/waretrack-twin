from pathlib import Path
import json, os
from faster_whisper import WhisperModel
root=Path(__file__).resolve().parent
model=WhisperModel('base',device='cpu',compute_type='int8',cpu_threads=4)
segments,info=model.transcribe(str(root/'output/waretrack-narration.wav'),language='zh',beam_size=5,condition_on_previous_text=False)
rows=[{'start':s.start,'end':s.end,'text':s.text} for s in segments]
(root/'output/narration-asr.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
print(json.dumps({'language':info.language,'transcript':rows},ensure_ascii=False),flush=True)
