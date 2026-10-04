import subprocess,json
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parent
sources=[('pantry-scoop-mobile-live.mp4',0,58),('mobile-details-live.mp4',10,95.1)]
clips=[]
for index,(filename,start,end) in enumerate(sources):
 cmd=['ffmpeg','-v','error','-i',str(root/filename),'-vf','fps=5,scale=120:214,format=gray','-f','rawvideo','-']
 data=subprocess.check_output(cmd);frames=np.frombuffer(data,dtype=np.uint8).reshape(-1,214,120)[:,13:202,17:103]
 diff=np.mean(np.abs(frames[1:].astype(float)-frames[:-1].astype(float)),axis=(1,2))
 ranges=[(start,start+2)]
 for n,val in enumerate(diff,1):
  t=n/5
  if start<=t<=end and val>.13:ranges.append((max(start,t-.7),min(end,t+1.3)))
 ranges.append((end-2,end));ranges.sort();merged=[]
 for a,b in ranges:
  if merged and a<=merged[-1][1]+.25:merged[-1]=(merged[-1][0],max(b,merged[-1][1]))
  else:merged.append((a,b))
 clips.extend([(index,a,b) for a,b in merged]); print(filename,merged)
total=sum(b-a for _,a,b in clips)
speed=max(1,total/55)
print('Live retained duration',total,'Speed',speed,'Final duration',total/speed)
(root/'live-edit.json').write_text(json.dumps({'sources':sources,'clips':clips,'speed':speed},indent=2))
filters=[]
for j,(source,a,b) in enumerate(clips):filters.append(f'[{source}:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{speed:.6f}[c{j}]')
filters.append(''.join(f'[c{j}]' for j in range(len(clips)))+f'concat=n={len(clips)}:v=1:a=0,format=yuv420p[out]')
cmd=['ffmpeg','-hide_banner','-loglevel','warning','-y','-filter_complex_threads','2']
for f,_,_ in sources:cmd+=['-i',str(root/f)]
cmd+=['-filter_complex',';'.join(filters),'-map','[out]','-c:v','libx264','-threads','4','-preset','fast','-crf','18','-pix_fmt','yuv420p','-r','30','-movflags','+faststart','-an',str(root/'pantry-scoop-mobile-demo.mp4')]
subprocess.run(cmd,check=True)
