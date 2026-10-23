import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile);
const root=fileURLToPath(new URL('..',import.meta.url));
const source=path.join(root,'skills/introbook-personalizer');

test('both packages share source, unpack independently, install safely and run through a link',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'introbook-dist-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  await exec('python3',[path.join(root,'scripts/build_packages.py'),'--output',path.join(temp,'packages')]);
  await exec('python3',['-c',`import json,sys,zipfile,pathlib
root=pathlib.Path(sys.argv[1]); a=root/'packages/introbook-personalizer-codex.zip'; b=root/'packages/introbook-personalizer-workbuddy.zip'
with zipfile.ZipFile(a) as x, zipfile.ZipFile(b) as y:
 assert x.namelist()==y.namelist()
 assert all(x.read(n)==y.read(n) for n in x.namelist())
 assert json.loads(x.read('introbook-personalizer/package-state.json'))['requiresLatestSources'] is True
 assert not any('tests/' in n or pathlib.Path(n).name=='sources.json' or '/Users/' in n for n in x.namelist())
 x.extractall(root/'unpacked')
`,temp]);
  const skill=path.join(temp,'unpacked/introbook-personalizer');
  const status=JSON.parse((await exec(process.execPath,[path.join(skill,'scripts/introbook.mjs'),'status'])).stdout);assert.equal(status.ready,false);
  const link=path.join(temp,'installed/introbook-personalizer');
  await exec(process.execPath,[path.join(skill,'scripts/install.mjs'),'--destination',link]);
  const linked=JSON.parse((await exec(process.execPath,[path.join(link,'scripts/introbook.mjs'),'status'])).stdout);assert.deepEqual(linked.missingBrands,['mingdao','nocoly']);
  await exec(process.execPath,[path.join(skill,'scripts/install.mjs'),'--destination',link]);
  const conflict=path.join(temp,'installed/conflict');await fs.mkdir(conflict);
  await assert.rejects(exec(process.execPath,[path.join(source,'scripts/install.mjs'),'--destination',conflict]),/not overwritten/);
});
