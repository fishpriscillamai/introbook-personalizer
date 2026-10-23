import fs from 'node:fs/promises';
import path from 'node:path';
export const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Kz8AAAAASUVORK5CYII=';
export async function fixture(root) {
  await fs.mkdir(root,{recursive:true});
  await fs.writeFile(path.join(root,'logo.png'),Buffer.from(PNG,'base64'));
  await fs.writeFile(path.join(root,'unused.woff2'),Buffer.from('font fixture'));
  await fs.copyFile(new URL('../skills/introbook-personalizer/assets/navigation.js',import.meta.url),path.join(root,'nav.js'));
  await fs.writeFile(path.join(root,'styles.css'),`@font-face{font-family:Unused;src:url('unused.woff2')}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#24384a;background:#f4f7fa}nav{height:60px;display:flex;align-items:center;gap:12px;padding:10px 4vw;background:white}section{width:100%;min-height:calc(100vh - 60px);padding:5vw}section[hidden]{display:none}h1{font-size:clamp(26px,4vw,60px)}p{font-size:clamp(18px,2vw,28px);max-width:48em;line-height:1.5}img{width:80px;height:80px;object-fit:contain}select{max-width:40vw}svg{max-width:100%;height:auto}button{min-height:32px}`);
  const deck = l => `<main data-locale-deck="${l}">
<section data-page-id="${l}-product" data-page-locale="${l}" data-slide="1" aria-label="page"><h1 data-slot-id="title">${l==='zh'?'平台价值':'Platform value'}</h1><p data-slot-id="copy">${l==='zh'?'用统一平台协同业务':'Coordinate business on one platform'}</p><p data-slot-id="fact">ISO 27001</p></section>
<section data-page-id="${l}-architecture" data-page-locale="${l}" data-slide="2" aria-label="page"><h1 data-slot-id="title">${l==='zh'?'技术架构':'Technical architecture'}</h1><svg width="600" height="180" viewBox="0 0 600 180"><rect width="600" height="180" fill="#2196f3"/><text x="40" y="100" fill="white" font-size="32">Immutable architecture diagram</text></svg></section>
<section data-page-id="${l}-case" data-page-locale="${l}" data-slide="3" aria-label="page"><h1 id="${l}-case-title" data-slot-id="title">${l==='zh'?'客户案例':'Customer case study'}</h1><p data-slot-id="copy">${l==='zh'?'原客户业务成果':'Donor customer outcome'}</p><img data-slot-id="logo" src="logo.png" alt="Original customer logo"></section>
<section data-page-id="${l}-contact" data-page-locale="${l}" data-slide="4" aria-label="page"><h1 data-slot-id="title">${l==='zh'?'联系我们':'Contact us'}</h1><p data-slot-id="copy">Fixture only / 测试样本</p></section></main>`;
  const html=`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TEST FIXTURE — not a standard IntroBook</title><link rel="stylesheet" href="styles.css"><script src="nav.js" defer></script></head><body><nav><button data-ib-prev>‹</button><select data-ib-directory aria-label="目录"></select><button data-ib-next>›</button><output data-ib-position></output><select data-ib-locale aria-label="语言"></select></nav>${deck('zh')}${deck('en')}</body></html>`;
  const input=path.join(root,'index.html');await fs.writeFile(input,html);return input;
}
