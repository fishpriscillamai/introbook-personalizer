#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const source=await fs.realpath(fileURLToPath(new URL('..',import.meta.url)));
const argv=process.argv.slice(2);
let destination=path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills','introbook-personalizer');
if(argv.length) {
  if(argv.length!==2||argv[0]!=='--destination') throw Error('Usage: node scripts/install.mjs [--destination <skill-link-path>]');
  destination=path.resolve(argv[1]);
}
await fs.mkdir(path.dirname(destination),{recursive:true});
destination=path.join(await fs.realpath(path.dirname(destination)),path.basename(destination));
try {
  const target=await fs.realpath(destination);
  if(target!==source) throw Error(`A different skill already exists at ${destination}; it was not overwritten`);
  console.log(JSON.stringify({installed:true,reused:true,path:destination}));
} catch(e) {
  if(e.code!=='ENOENT') throw e;
  // lstat catches broken existing links; never replace a user's installation.
  try { await fs.lstat(destination); throw Error('An existing broken link occupies the destination'); }
  catch(check) { if(check.code!=='ENOENT') throw check; }
  const target=process.platform==='win32'?source:path.relative(path.dirname(destination),source);
  await fs.symlink(target,destination,process.platform==='win32'?'junction':'dir');
  console.log(JSON.stringify({installed:true,reused:false,path:destination}));
}
