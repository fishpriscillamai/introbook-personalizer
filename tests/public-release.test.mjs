import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));

test('public export has only reviewed source and portable tools; packages select latest registration',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'introbook-public-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const exported=path.join(temp,'public');
 await exec('python3',[path.join(root,'scripts/prepare_public_release.py'),'--output',exported]);
 await assert.rejects(exec('python3',[path.join(root,'scripts/prepare_public_release.py'),'--output',exported]),/exist/i);
 const manifest=JSON.parse(await fs.readFile(path.join(exported,'publication-manifest.json'),'utf8'));
 assert.equal(manifest.version,'1.0.0');assert.equal(manifest.templateFilesInGit,0);
 assert(!manifest.files.some(f=>/(?:^|\/)(?:materials|outputs|\.work|deliveries|sources\.json|run\.json)(?:\/|$)/.test(f.path)));
 for(const item of manifest.files){const data=await fs.readFile(path.join(exported,item.path));assert.equal(createHash('sha256').update(data).digest('hex'),item.sha256);assert(!data.toString().includes(root));}
 const skill=path.join(exported,'skills/introbook-personalizer');
 const status=JSON.parse((await exec(process.execPath,[path.join(skill,'scripts/introbook.mjs'),'status'])).stdout);assert.equal(status.ready,false);
 for(const brand of ['mingdao','nocoly'])for(const [version,date] of [['z-old','2026-01-01T00:00:00Z'],['a-new','2026-10-23T00:00:00Z']]){
  const dir=path.join(skill,'assets/templates',brand,version);await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({brand,version,registeredAt:date}));
  await fs.writeFile(path.join(dir,'index.html'),'<html>Test fixture only</html>');
 }
 const packages=path.join(temp,'packages');
 await exec('python3',[path.join(exported,'scripts/build_packages.py'),'--output',packages,'--include-templates','--latest-templates']);
 await exec('python3',['-c',`import pathlib,sys,zipfile,json
with zipfile.ZipFile(pathlib.Path(sys.argv[1])/'introbook-personalizer-codex.zip') as z:
 state=json.loads(z.read('introbook-personalizer/package-state.json'))
 assert state['version']=='1.0.0' and state['standardTemplates']==2
 assert any('/a-new/' in n for n in z.namelist())
 assert not any('/z-old/' in n for n in z.namelist())
`,packages]);
});
