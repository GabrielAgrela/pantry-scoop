import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { JSDOM } = createRequire(process.env.PANTRY_UI_NODE_MODULES ? `${process.env.PANTRY_UI_NODE_MODULES}/package.json` : import.meta.url)('jsdom');
const base = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const dom = new JSDOM(readFileSync(`${base}/public/index.html`, 'utf8'), { url: 'http://127.0.0.1:3210' });
const { window } = dom;
let lastScroll;
window.scrollTo = (x, y) => { lastScroll = [x, y]; };
for (const key of ['window', 'document', 'location', 'history', 'localStorage', 'CustomEvent', 'HTMLElement', 'HTMLDialogElement', 'navigator']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
globalThis.confirm = () => true;
const { api } = await import(`${base}/public/js/api.js`);
const { sampleRecipe } = await import(`${base}/test/fakes/fixtures.ts`);
const recipe = sampleRecipe();
let ingredients = [
 {id:1,name:'Tomatoes',category:'vegetables',notes:'Cherry variety',inStock:true},
 {id:2,name:'Basil',category:'vegetables',notes:'Fresh leaves',inStock:true},
 {id:3,name:'Milk',category:'dairy',notes:'Oat milk',inStock:false},
 {id:4,name:'Lemons',category:'fruit',notes:'',inStock:true},
];
let profile = {appliances:[{name:'Oven',details:'200°C max'},{name:'Blender',details:'1 L jug'}],dishTypes:[{name:'Dinner',details:'Main course'}],servings:2,units:'Metric',language:'English',preferences:'Vegetarian'};
let saved = [], suggestionPayload, completedUrl;
const clone = (data) => structuredClone(data);
Object.assign(api, {
 getAuthConfig:async()=>({mode:'local'}),
 getAccount:async()=>({user:{name:'Test cook',email:'cook@example.com',model:''},planUsageEnabled:true,showPlanWelcome:false}),
 listModels:async()=>({models:[]}),
 listIngredients:async()=>({ingredients:clone(ingredients),categories:['vegetables','dairy','fruit','other']}),
 listJobs:async()=>({jobs:[]}),
 addIngredient:async({name,category='other',notes=''})=>{const ingredient={id:ingredients.length+1,name,category,notes,inStock:true};ingredients.push(ingredient);return {status:'added',ingredient:clone(ingredient)};},
 updateIngredient:async(id,changes)=>{const ingredient=ingredients.find(i=>i.id===id);Object.assign(ingredient,changes);return {ingredient:clone(ingredient)};},
 deleteIngredient:async(id)=>{ingredients=ingredients.filter(i=>i.id!==id);},
 getProfile:async()=>({profile:clone(profile)}),
 updateProfile:async(data)=>{profile={...profile,...clone(data)};return {profile:clone(profile)};},
 resetProfile:async()=>({profile:clone(profile)}),
 listSavedRecipes:async()=>({recipes:clone(saved)}),
 suggestRecipes:async(data)=>{suggestionPayload=clone(data);return {job:{id:1,status:'succeeded',result:{recipes:[recipe]}}};},
 saveRecipe:async(recipe)=>{saved.push({id:1,recipe:clone(recipe)});return {ok:true};},
 deleteSavedRecipe:async(id)=>{saved=saved.filter(i=>i.id!==id);},
 completeSignIn:async(url)=>{completedUrl=url;return {ok:true};},
 signOut:async()=>({revoked:true}),
});
const tick=()=>new Promise(r=>setTimeout(r,20));
const $=s=>document.querySelector(s);
const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const input=(el,value)=>{el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));};
const submit=el=>el.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
await import(`${base}/public/js/main.js`);
await tick();
const stock=$('#view-stock');
assert.equal(document.body.dataset.page,'stock');
assert.equal(stock.hidden,false);
assert.equal(stock.querySelector('.pantry-stats').textContent,'3 in stock · 1 to restock');
assert.equal(stock.querySelectorAll('.item').length,3);
button(stock,'Add').click();
input($('dialog input'),'Cucumber'); submit($('dialog form')); await tick();
assert.equal(ingredients.length,5);
const filter=stock.querySelector('[aria-label="Filter ingredients"]');
filter.value='produce';filter.dispatchEvent(new window.Event('change'));
assert.equal(stock.querySelectorAll('.item').length,3);
input(stock.querySelector('[type=search]'),'Fresh');
assert.equal(stock.querySelectorAll('.item').length,1);
assert.match(stock.querySelector('.item').textContent,/Basil/);
input(stock.querySelector('[type=search]'),'');filter.value='';filter.dispatchEvent(new window.Event('change'));
button(stock,'To restock1').click();
stock.querySelector('.stock-toggle').click(); await tick();
assert.equal(ingredients.find(i=>i.name==='Milk').inStock,true);
assert.equal(stock.querySelectorAll('.item').length,0);
button(stock,'In stock5').click();
stock.querySelector('[data-ingredient-id="2"] .item-edit').click();
input($('dialog input[aria-label=Name]'),'Fresh basil');submit($('dialog form'));await tick();
assert.equal(ingredients.find(i=>i.id===2).name,'Fresh basil');
console.log('PASS pantry: search, grouped filters, manual addition, restock and editing');
location.hash='#recipes';window.dispatchEvent(new window.HashChangeEvent('hashchange'));await tick();
const recipes=$('#view-recipes');
assert.equal(recipes.hidden,false);
assert.equal(recipes.querySelector('.form-options').open,false);
input(recipes.querySelector('[aria-label=Craving]'),'A cozy dinner');
input(recipes.querySelector('[aria-label=Servings]'),'4');
const [oven,blender]=recipes.querySelectorAll('.appliance-choice');oven.click();blender.click();blender.click();assert.equal(oven.dataset.mode,'use');assert.equal(blender.dataset.mode,'avoid');const easy=recipes.querySelector('.segmented input[value=easy]');easy.checked=true;easy.dispatchEvent(new window.Event('change'));
submit(recipes.querySelector('form'));await tick();
assert.equal(suggestionPayload.craving,'A cozy dinner');assert.equal(suggestionPayload.servings,4);assert.deepEqual(suggestionPayload.appliances,['Oven']);assert.deepEqual(suggestionPayload.avoidAppliances,['Blender']);assert.equal(suggestionPayload.difficulty,'easy');
assert.equal(recipes.querySelectorAll('.suggestion-grid article').length,1);
recipes.querySelector('.recipe-bookmark').click();await tick();
assert.equal(saved.length,1);
assert.equal(recipes.querySelector('.recipe-bookmark').getAttribute('aria-pressed'),'true');
button(recipes,'Saved 1').click();
assert.equal(recipes.querySelectorAll('.saved-recipe').length,1);
recipes.querySelector('.recipe-open').click();
assert.match($('dialog').textContent,/Ingredients/);
$('dialog button[aria-label="Close recipe"]').click();
console.log('PASS recipes: generation payload, bookmark, saved collection and detail sheet');
let recipeFinished=false;
api.suggestRecipes=async()=>({job:{id:2,status:'running'}});
api.getJob=async()=>({job:{id:2,status:recipeFinished?'succeeded':'running',result:{recipes:[recipe]}}});
submit(recipes.querySelector('form'));await tick();
assert.equal($('#recipe-progress').hidden,false);
assert.equal(recipes.querySelector('.recipe-results .spinner'),null);
const kitchen=$('#view-profile');
let profileReadCount=0, resolveProfile;
api.getProfile=()=>{profileReadCount++;return profileReadCount===1?Promise.reject(new Error('Connection interrupted')):new Promise(resolve=>{resolveProfile=resolve;});};
button($('.tabbar'),'Kitchen').click();await tick();
assert.equal(kitchen.querySelector('form').hidden,true,'an unloaded profile is never shown as an empty editable kitchen');
assert.match(kitchen.querySelector('[role=alert]').textContent,/Connection interrupted/);
assert.equal(kitchen.querySelector('.kitchen-save button').disabled,true);
submit(kitchen.querySelector('form'));await tick();
assert.equal(profile.servings,2,'an unloaded form cannot overwrite saved preferences');
button(kitchen,'Try again').click();await tick();
assert.match(kitchen.querySelector('[role=status]').textContent,/Loading your kitchen/);
assert.equal(kitchen.querySelector('form').hidden,true);
window.dispatchEvent(new window.HashChangeEvent('hashchange'));await tick();
assert.equal(profileReadCount,2,'repeated activation shares the pending profile request');
resolveProfile({profile:clone(profile)});await tick();
api.getProfile=async()=>({profile:clone(profile)});
assert.equal(kitchen.querySelector('form').hidden,false);
assert.equal(kitchen.querySelector('.kitchen-load-state').hidden,true);
assert.equal(kitchen.querySelector('[aria-label="Edit servings"] .default-value').textContent,'2');
console.log('PASS kitchen loading: persistent failure, retry, no empty-form writes and pending-request deduplication');
assert.equal($('#recipe-progress').hidden,false,'progress survives tab navigation');
const {toast}=await import(`${base}/public/js/dom.js`);toast('Another action completed');
assert.equal($('#recipe-progress').hidden,false,'ordinary toasts do not replace job progress');
recipeFinished=true;await new Promise(r=>setTimeout(r,1600));
assert.equal($('#recipe-progress').hidden,true);
assert.equal(recipes.querySelector('.recipe-generator .primary').disabled,false);
console.log('PASS recipe progress: persistent across tabs and other toasts, clears on completion');
assert.equal(kitchen.querySelectorAll('.appliance').length,2);
kitchen.querySelector('[aria-label="Edit servings"]').click();input($('dialog input'),'3');submit($('dialog form'));
button(kitchen,'Add').click();
input($('dialog input'),'Air fryer');input($('dialog textarea'),'4 L basket');submit($('dialog form'));await tick();
assert.equal(profile.appliances.length,3);
assert.equal(profile.servings,2);
assert.equal(kitchen.querySelector('[aria-label="Edit servings"] .default-value').textContent,'3');
submit(kitchen.querySelector('form'));await tick();
assert.equal(profile.servings,3);
assert.equal(profile.appliances.length,3);
let resolveRefresh;
api.getProfile=()=>new Promise(resolve=>{resolveRefresh=resolve;});
window.dispatchEvent(new window.HashChangeEvent('hashchange'));await tick();
kitchen.querySelector('[aria-label="Edit servings"]').click();input($('dialog input'),'4');submit($('dialog form'));
resolveRefresh({profile:clone(profile)});await tick();
assert.equal(kitchen.querySelector('[aria-label="Edit servings"] .default-value').textContent,'4','late profile reads preserve edits made while they were pending');
api.getProfile=async()=>({profile:clone(profile)});
console.log('PASS kitchen: editable defaults, appliance addition preserves unsaved defaults, save');
button($('#account'),'Sign out').click();await tick();
assert.equal(document.body.dataset.page,'login');assert.equal($('.tabbar').hidden,true);
assert.ok(button($('#view-login'),'Continue with ChatGPT'));
console.log('PASS sign out and signed-out state');
console.log('UI interaction checks passed. Rendering requires a separate built-in Browser check.');
window.close();
