import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 let cb=0;
 const conversations=[{id:1,title:'Первая беседа',archived:false,pinned:false,project_id:null},{id:2,title:'Вторая беседа',archived:false,pinned:false,project_id:1}];
 const projects=[{id:1,title:'Проект Alpha',archived:false}];
 window.fixture={calls:[],conversations,projects};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>++cb,unregisterCallback:()=>{},invoke:async(cmd,a={})=>{
  window.fixture.calls.push([cmd,a]);
  const conversation=conversations.find(c=>c.id===a.conversationId),project=projects.find(p=>p.id===a.id);
  if(cmd==='list_conversations')return structuredClone(conversations);
  if(cmd==='list_projects')return structuredClone(projects);
  if(cmd==='search_conversations')return conversations.filter(c=>c.title.includes(a.query));
  if(cmd==='list_history')return {messages:[],attachments:[],artifacts:[],contexts:[],attempts:[],active_leaf_id:null};
  if(cmd==='list_models'||cmd==='refresh_models')return {fetched_at:1794400000,models:[]};
  if(cmd==='get_response_style')return 'balanced';
  if(cmd==='get_agent_board')return {plan:[],queue:[],steering:[]};
  if(cmd==='key_status')return false;
  if(cmd==='get_agent_skill'||cmd==='list_project_folder')return null;
  if(cmd==='create_project'){projects.push({id:projects.length+1,title:'Новый проект',archived:false});return projects.length}
  if(cmd==='rename_project'){project.title=a.title;return}
  if(cmd==='archive_project'){project.archived=a.archived;return}
  if(cmd==='create_conversation'){const id=conversations.length+1;conversations.push({id,title:'Новая беседа',archived:false,pinned:false,project_id:null});return id}
  if(cmd==='rename_conversation'){conversation.title=a.title;return}
  if(cmd==='archive_conversation'){conversation.archived=a.archived;return}
  if(cmd==='set_conversation_pinned'){conversation.pinned=a.pinned;return}
  if(cmd==='move_conversation'){conversation.project_id=a.projectId;return}
  if(cmd==='preview_context')return {model_id:'local-mock',response_style:'balanced',messages:[],omitted_exchanges:0,bytes:0,request_bytes:0,warning:''};
  if(cmd==='start_mock_generation')return 123;
  if(cmd.startsWith('plugin:'))return 1;
  return [];
 }};
});
await page.goto('http://127.0.0.1:1423');
const sidebar=()=>page.locator('.project-sidebar');
await sidebar().waitFor();
assert.equal(await page.locator('.app-dock').evaluate(e=>e.getBoundingClientRect().width),48);
assert.equal(await sidebar().evaluate(e=>e.getBoundingClientRect().width),264);
assert.equal(await page.locator('.chat-header').evaluate(e=>e.getBoundingClientRect().height),48);
const separator=page.getByRole('separator',{name:'Ширина навигации'});
await separator.focus();await page.keyboard.press('End');assert.equal(await separator.getAttribute('aria-valuenow'),'320');
await page.keyboard.press('ArrowLeft');assert.equal(await separator.getAttribute('aria-valuenow'),'310');
await page.reload();await sidebar().waitFor();assert.equal(await separator.getAttribute('aria-valuenow'),'310');
await page.setViewportSize({width:1100,height:850});await sidebar().waitFor({state:'detached'});
await page.getByRole('button',{name:'Открыть навигацию'}).click();await sidebar().waitFor();
assert.ok(await page.locator('.chat-panel').evaluate(e=>e.getBoundingClientRect().width)>=560);
await page.setViewportSize({width:800,height:850});await sidebar().waitFor({state:'detached'});
await page.getByRole('button',{name:'Открыть навигацию'}).click();
let sheet=page.getByRole('dialog',{name:'Беседы',exact:true});await sheet.waitFor();
await page.getByRole('searchbox',{name:'Поиск бесед'}).waitFor();
assert.equal(await page.locator(':focus').getAttribute('aria-label'),'Поиск бесед');
await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
assert.equal(await page.locator(':focus').getAttribute('aria-label'),'Открыть навигацию');
await page.getByRole('button',{name:'Открыть навигацию'}).click();
await sheet.getByRole('button',{name:'Вторая беседа',exact:true}).click();await sheet.waitFor({state:'detached'});
assert.equal(await page.locator('h1').textContent(),'Вторая беседа');
await page.setViewportSize({width:1280,height:850});await sidebar().waitFor();
assert.equal(await separator.getAttribute('aria-valuenow'),'310');
// Click menus and context menus share the exact dialog/actions.
await sidebar().getByRole('button',{name:'Действия беседы Вторая беседа'}).first().click();
let actions=page.getByRole('dialog',{name:'Вторая беседа',exact:true});
const labels=await actions.getByRole('button').allTextContents();
await actions.getByRole('button',{name:'Закрыть',exact:true}).click();
await sidebar().getByRole('button',{name:'Вторая беседа',exact:true}).first().click({button:'right'});
assert.deepEqual(await actions.getByRole('button').allTextContents(),labels);
await actions.getByRole('button',{name:'Закрепить',exact:true}).click();
await sidebar().getByRole('button',{name:'Действия беседы Вторая беседа'}).first().click();
await actions.getByRole('button',{name:'Переименовать',exact:true}).click();
let rename=page.getByRole('dialog',{name:'Переименовать беседу',exact:true});await rename.getByRole('textbox',{name:'Название'}).fill('Переименованная беседа');await rename.getByRole('button',{name:'Сохранить',exact:true}).click();await rename.waitFor({state:'detached'});
assert.equal(await page.locator('h1').textContent(),'Переименованная беседа');
await sidebar().getByRole('button',{name:'Действия беседы Переименованная беседа'}).first().click();
actions=page.getByRole('dialog',{name:'Переименованная беседа',exact:true});await actions.getByRole('combobox',{name:'Переместить беседу'}).selectOption('0');
assert.equal(await page.locator('.conversation-project').inputValue(),'0');
await sidebar().getByRole('button',{name:'Действия беседы Переименованная беседа'}).first().click();await actions.getByRole('button',{name:'Архивировать',exact:true}).click();
await page.waitForFunction(()=>window.fixture.conversations.find(c=>c.id===2).archived);
await sidebar().getByText('Архив бесед',{exact:true}).click();
await sidebar().getByRole('button',{name:'Действия беседы Переименованная беседа'}).click();await actions.getByRole('button',{name:'Восстановить',exact:true}).click();
await page.getByRole('searchbox',{name:'Поиск бесед'}).fill('Отсутствует');await page.waitForTimeout(250);assert.ok(await sidebar().getByText('Ничего не найдено',{exact:true}).count()>0);
await page.getByRole('searchbox',{name:'Поиск бесед'}).fill('');await page.waitForTimeout(250);
// Draft cancel remains in place.
await page.locator('#prompt').fill('Черновик');
page.once('dialog',d=>d.dismiss());await sidebar().getByRole('button',{name:'Закреплено · Переименованная беседа',exact:true}).first().click();
assert.equal(await page.locator('#prompt').inputValue(),'Черновик');assert.equal(await page.locator('h1').textContent(),'Первая беседа');
// Narrow and zoom-equivalent CSS viewport do not overflow the body.
for(const width of [1440,1200,1199,960,959,640,639,560,320]){
 await page.setViewportSize({width,height:850});
 await page.waitForTimeout(50);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`horizontal overflow ${width}`);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),`body scroll ${width}`);
 if(width<640)assert.equal(await page.locator('.app-dock').isVisible(),false);
}
assert.deepEqual(errors,[]);
await page.screenshot({path:'/private/tmp/shell-narrow.png'});
await browser.close();console.log('Shell interaction and responsive checks passed');
