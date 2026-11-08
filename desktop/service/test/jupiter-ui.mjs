import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '../server.mjs';
import { themePalette } from '../appearance.mjs';
import { localDay } from '../workspace.mjs';
import { launchBrowser, desktopAuth } from './browser.mjs';
import { expect } from '@playwright/test';
const root = process.cwd();
const repo = await mkdtemp(path.join(root, '.cache/jupiter-ui-'));
await mkdir(path.join(repo,'workspace/sample'),{recursive:true});
await mkdir(path.join(repo,'inbox'));
const registry = path.join(repo,'workspace/workspace.json');
await writeFile(path.join(repo,'workspace/sample/report.html'),'<h1>Sample report</h1>');
await writeFile(registry,JSON.stringify({entities:[{id:'sample',title:'Sample',folder:'sample',category:'research',status:'active',created:localDay(),steps:[{name:'Report',path:'report.html'}]}]}));
await cp(path.join(root,'public/assets'),path.join(root,'dist/assets'),{recursive:true});
const service = await createService({repo,uiDir:path.join(root,'dist'),mcpOptions:{home:repo,env:{}}});
const session=service.sessions.make({id:'shell-fixture',name:'Shell fixture',agent:'shell',cwd:repo,status:'running',open:true,pinned:false,createdAt:new Date().toISOString(),cols:90,rows:30});
service.sessions.items.set(session.id,session); await service.sessions.hydrate(session);
session.process={write(){},resize(){},kill(){}};
let browser;
try {
 browser=await launchBrowser();const context=await browser.newContext({viewport:{width:1440,height:900}});await desktopAuth(context,service.urls.workspace);
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(service.urls.workspace);
 const panel=page.getByRole('complementary',{name:'Chats',exact:true});await expect(panel).toBeVisible();await expect(page.getByRole('button',{name:'New chat',exact:true})).toBeVisible();
 await expect(page.locator('.files-rail').getByRole('button',{name:'Hide Chats',exact:true})).toHaveAttribute('aria-pressed','true');await panel.getByRole('button',{name:'Hide Chats',exact:true}).click();await expect(panel).toBeHidden();assert.equal(await page.locator('.chats-surface').count(),1);
 await page.getByTitle('Show Chats',{exact:true}).click();await expect(panel).toBeVisible();await page.locator('.files-rail').getByRole('button',{name:'Hide Chats',exact:true}).click();await expect(panel).toBeHidden();await page.locator('.files-rail').getByRole('button',{name:'Show Chats',exact:true}).click();await expect(panel).toBeVisible();await expect(page.locator('.chat-current').filter({hasText:'Shell fixture'})).toBeVisible();
 const splitter=page.getByRole('separator',{name:'Resize Chats'});const b=await splitter.boundingBox();const before=(await panel.boundingBox()).width;await page.mouse.move(b.x+3,b.y+100);await page.mouse.down();await page.mouse.move(b.x-90,b.y+160,{steps:10});await page.mouse.up();assert.ok((await panel.boundingBox()).width>before+60);assert.equal((await panel.boundingBox()).height,900);
 for(const category of ['dev','pinned','image-gen']){
 const card=page.locator('.home [data-entity="sample"]');const target=page.locator(`[data-card-section="${category}"]`);await target.scrollIntoViewIfNeeded();await card.scrollIntoViewIfNeeded();const a=await card.boundingBox();const z=await target.boundingBox();await page.mouse.move(a.x+20,a.y+20);await page.mouse.down();await page.mouse.move(z.x+20,z.y+15,{steps:15});await page.mouse.up();await expect.poll(async()=>{const e=JSON.parse(await readFile(registry,'utf8')).entities[0];return category==='pinned'?e.pinned:e.category;}).toBe(category==='pinned'?true:category);
 }
 assert.equal(await page.locator('.section-count,.sidebar-count').count(),0);await page.reload();await expect(page.locator('[data-card-section="image-gen"] [data-entity="sample"]')).toBeVisible();
 await page.getByRole('button',{name:'Toggle settings'}).click();await expect(page.getByLabel('Chat theme',{exact:true})).toBeVisible();await page.getByLabel('Chat theme',{exact:true}).selectOption('light');await expect(panel).toHaveCSS('--bg',themePalette('light').bg);await page.getByRole('button',{name:'Toggle settings'}).click();
 const request = async (url, data) => {
   const response = await fetch(new URL('/api'+url,service.urls.workspace),{method:'POST',headers:{Authorization:'Bearer '+new URL(service.urls.workspace).searchParams.get('token'),'Content-Type':'application/json'},body:JSON.stringify(data)});
   const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
 };
 const source=path.join(repo,'workspace/sample/report.html');
 const copied=await request('/files/import-path',{path:source,folder:path.join(repo,'inbox')});assert.equal(await readFile(copied.path,'utf8'),'<h1>Sample report</h1>');
 const duplicate=await request('/files/import-path',{path:source,folder:path.join(repo,'inbox')});assert.equal(duplicate.renamed,true);assert.notEqual(duplicate.path,copied.path);
 await expect.poll(()=>page.locator('.jupiter-logo').first().evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true);
 await page.screenshot({path:path.join(root,'.cache/jupiter-ui.png')});assert.deepEqual(errors,[]);console.log('Jupiter integration checks passed: panel lifecycle, shell fixture, resizing, persisted card moves, settings, branding load.');
} finally {await browser?.close();await service.close();}
