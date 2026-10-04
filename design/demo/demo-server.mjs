import {buildApp} from '../../src/http/app.ts';
import {buildTestContainer,sampleRecipe} from '../../test/fakes/fixtures.ts';
import {fileURLToPath} from 'node:url';
const ctx=buildTestContainer(Date.now);
ctx.openai.nextIdentity.name='Demo cook';
const app=await buildApp(ctx.container,{publicDir:fileURLToPath(new URL('../../public',import.meta.url))});
let cookie;
app.get('/demo-session',async(req,reply)=>reply.setCookie('ps_session',cookie,{httpOnly:true,sameSite:'lax',path:'/'}).redirect('/'));
const start=await app.inject({url:'/auth/chatgpt/start'});
const binding=start.cookies.find(c=>c.name==='ps_signin').value;
const done=await app.inject({url:'/auth/callback?'+ctx.openai.callbackParams(),cookies:{ps_signin:binding}});
cookie=done.cookies.find(c=>c.name==='ps_session').value;
const user=ctx.auth.userForSession(cookie), services=ctx.container.forUser(user.id);
for (const ingredient of [
{name:'Tomatoes',category:'vegetables',notes:'Cherry tomatoes'},
{name:'Basil',category:'vegetables',notes:'Fresh leaves'},
{name:'Lemons',category:'fruit'},
{name:'Milk',category:'dairy'},
{name:'Eggs',category:'eggs'},
{name:'Pasta',category:'grains'},
{name:'Olive oil',category:'condiments'}]) services.stock.addManual(ingredient);
const milk=services.stock.list().find(i=>i.name==='Milk');services.stock.update(milk.id,{inStock:false});
services.profile.update({appliances:[{name:'Hob',emoji:'🍳',details:'Induction, 4 rings'},{name:'Oven',emoji:'♨️',details:'Fan oven, up to 220°C'},{name:'Blender',emoji:'🥤',details:'1 litre jug'}],servings:2,units:'Metric',language:'English',preferences:'Vegetarian. Simple everyday meals.'});
ctx.generator.answer=[sampleRecipe({title:'Lemon & basil pasta',kind:'Dinner',summary:'Bright lemon, fresh basil and a little creamy comfort. A simple dinner made from your pantry.',makes:'2 servings',totalMinutes:20,equipment:['Hob'],ingredients:[{name:'Pasta',amount:'180 g',inStock:true},{name:'Basil',amount:'1 handful',inStock:true},{name:'Lemons',amount:'1, zest and juice',inStock:true},{name:'Olive oil',amount:'2 tbsp',inStock:true},{name:'Tomatoes',amount:'150 g',inStock:true}],steps:['Bring a large pan of salted water to the boil. Cook the pasta until al dente, reserving a cup of the cooking water.','Warm the olive oil in a pan. Add the halved cherry tomatoes and cook for 4 minutes.','Add the pasta, lemon zest and a splash of cooking water. Toss until glossy.','Finish with fresh basil and lemon juice, then divide between two bowls.'],tips:['Save some pasta water for a silky sauce.','Tear the basil just before serving.'],estimate:{kcalMin:430,kcalMax:510,sugarGramsMin:4,sugarGramsMax:7,portions:2,proteinGrams:14,carbsGrams:76,fatGrams:16,fibreGrams:6,saltGrams:1}}),sampleRecipe({title:'Tomato & basil frittata',kind:'Dinner',summary:'Fluffy eggs with sweet tomatoes and garden-fresh basil.',totalMinutes:25,equipment:['Oven'],makes:'2 servings'}),sampleRecipe({title:'Roasted tomato pasta',kind:'Dinner',summary:'Slow-roasted tomatoes make an easy, comforting sauce.',totalMinutes:35,equipment:['Oven','Hob'],makes:'2 servings'})];
await app.listen({host:'127.0.0.1',port:3214});
console.log('Demo ready: http://127.0.0.1:3214/demo-session (in-memory sample data)');
