import { buildApp } from '../src/http/app.ts';
import { buildTestContainer, sampleRecipe, TINY_JPEG_DATA_URL } from '../test/fakes/fixtures.ts';
import { fileURLToPath } from 'node:url';
import { UsageLimitError } from '../src/domain/errors.ts';
// Local-only visual QA. No real identities, tokens, AI requests or persistent data.
const ctx=buildTestContainer(Date.now);
// Job previews and edits survive reloads. Give each isolated run a fresh id range.
ctx.db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES ('jobs',?)").run(Date.now());
const app=await buildApp(ctx.container,{publicDir:fileURLToPath(new URL('../public',import.meta.url))});
let cookie;
app.get('/qa-session',async(req,reply)=>reply.setCookie('ps_session',cookie,{httpOnly:true,sameSite:'lax',path:'/'}).redirect('/'));
app.get('/qa-scan-matches',async(req,reply)=>{services.stock.addIfMissing({name:'Óleo alimentar',category:'condiments',notes:'',source:'manual'});ctx.detector.answer=[{name:'Azeite',category:'condiments'},{name:'Óleo alimentar',category:'condiments'}];await app.inject({method:'POST',url:'/api/scan',cookies:{ps_session:cookie},payload:{images:[TINY_JPEG_DATA_URL]}});return reply.redirect('/#stock');});
app.get('/qa-scan',async(req,reply)=>{await app.inject({method:'POST',url:'/api/scan',cookies:{ps_session:cookie},payload:{images:[TINY_JPEG_DATA_URL]}});return reply.redirect('/#stock');});
app.get('/qa-classification-error',async(req,reply)=>{ctx.classifier.answer=new UsageLimitError('Your ChatGPT plan has reached its usage limit. Check your usage or try again later.');return reply.redirect('/#stock');});
app.get('/qa-classification-ready',async(req,reply)=>{ctx.classifier.answer=classificationAnswer;return reply.redirect('/#stock');});
app.get('/qa-empty',async(req,reply)=>{for(const item of services.stock.list())services.stock.remove(item.id);return reply.redirect('/#stock');});
app.get('/qa-recipe-error',async(req,reply)=>{
  const answer=ctx.generator.answer;
  ctx.generator.answer=new UsageLimitError('Your ChatGPT plan has reached its usage limit. Check your usage or try again later.');
  await app.inject({method:'POST',url:'/api/recipes/suggestions',cookies:{ps_session:cookie},payload:{kind:'Dinner',count:3,maxMissing:0}});
  ctx.generator.answer=answer;
  return reply.redirect('/#recipes');
});
const start=await app.inject({url:'/auth/chatgpt/start'});
const binding=start.cookies.find(c=>c.name==='ps_signin').value;
const done=await app.inject({url:'/auth/callback?'+ctx.openai.callbackParams(),cookies:{ps_signin:binding}});
cookie=done.cookies.find(c=>c.name==='ps_session').value;
const user=ctx.auth.userForSession(cookie);
const services=ctx.container.forUser(user.id);
// Idea-ribbon QA can start in an established kitchen without walking through onboarding.
if (process.env.QA_IDEA_LABELS) services.profile.update({ ...services.profile.get(), setupComplete: true });
for(const item of [{name:'Tomatoes',category:'vegetables',notes:'Cherry variety'},{name:'Basil',category:'vegetables',notes:'Fresh leaves'},{name:'Lemons',category:'fruit'},{name:'Milk',category:'dairy'}]) services.stock.addManual(item);
ctx.detector.answer=[{name:'Strawberries',category:'fruit',notes:'Fresh punnet'},{name:'Greek yogurt',category:'dairy',notes:'Plain'}];
// Optional delay exercises the real loading UI without calling an AI provider.
if (process.env.QA_RECIPE_DELAY_MS) {
  const suggest = ctx.generator.suggest.bind(ctx.generator);
  ctx.generator.suggest = async (...args) => {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.QA_RECIPE_DELAY_MS)));
    return suggest(...args);
  };
}
ctx.generator.answer=[sampleRecipe({title:'Potato & courgette oven frittata',difficulty:'medium',creativity:'familiar',summary:'A golden, cozy oven frittata with tender potatoes and courgette. Lovely with a little side salad.',kind:'Dinner',makes:'2 servings',totalMinutes:40,equipment:['Microwave','Oven'],ingredients:[{name:'Ovos',amount:'250 ml, beaten',inStock:false},{name:'Batatas',amount:'600 ml, peeled and cut into small cubes',inStock:false},{name:'Courgette',amount:'350 ml, thinly sliced',inStock:false},{name:'Milk',amount:'80 ml',inStock:true},{name:'Azeite',amount:'1 tbsp, divided',inStock:true},{name:'Água',amount:'2 tbsp',inStock:true},{name:'Cebolinho folha',amount:'1 tsp',inStock:true},{name:'Noz moscada moída',amount:'1/8 tsp',inStock:true},{name:'Sal',amount:'1/2 tsp',inStock:true},{name:'Pimenta',amount:'1/4 tsp',inStock:true}],steps:['Heat the oven to 190°C. Grease a shallow ovenproof dish with 1 tsp oil.','Put the potatoes and water in a microwave-safe bowl. Cover loosely and microwave on high for 6–8 minutes, stirring halfway, until almost tender.','Whisk the eggs, milk, chives, nutmeg, salt and pepper. Fold in the potatoes and courgette.','Pour into the dish and bake for 25–30 minutes, until golden and set. Rest for 5 minutes before slicing.'],tips:['Slice the courgette thinly so it cooks evenly.','A little leftover frittata makes a lovely lunch tomorrow.'],estimate:{kcalMin:850,kcalMax:1050,sugarGramsMin:12,sugarGramsMax:19}}),sampleRecipe({title:'Creamy lemon & basil pasta',difficulty:'easy',creativity:'creative',kind:'Dinner',summary:'Bright lemon, fresh basil and a little creamy comfort.'}),sampleRecipe({title:'Olive oil ice cream',difficulty:'easy',creativity:'adventurous',summary:'A silky scoop with a fruity olive oil finish.'})];
for(const name of ['Azeite','Água','Cebolinho folha','Noz moscada moída','Sal','Pimenta'])services.stock.addManual({name});
if (process.env.QA_LONG_IDEA) {
  ctx.generator.answer[0] = sampleRecipe({ title:'Dark Chocolate & Toasted Hazelnut Mascarpone Ice Cream (Erythritol)', difficulty:'medium', creativity:'creative', makes:'~800 ml mix (6 scoops)', totalMinutes:70, kind:'Ice cream', summary:'A rich, custard-free chocolate-hazelnut ice cream built on mascarpone and skim milk, sweetened with erythritol and kept scoopable with a splash of vodka. Nutty, deep and creamy without any eggs.', equipment:['Hob','Blender','Fridge','Freezer','Compressor ice cream machine'] });
  services.recipes.save(ctx.generator.answer[0]);
}
const milk=services.stock.list().find(i=>i.name==='Milk');services.stock.update(milk.id,{inStock:false});
const soup = services.stock.addManual({name:'Miso soup',notes:'Ready to heat'}).ingredient;
ctx.classifier.delayMs = 1400;
const classificationAnswer = ctx.classifier.answer = services.stock.list().filter((item) => item.category === 'other').map(({id,name}) => ({id,category: name === 'Miso soup' ? 'custom:Soups & broths' : ['Azeite','Água'].includes(name) ? (name === 'Água' ? 'drinks' : 'condiments') : 'herbs-spices'}));
await app.listen({host:process.env.QA_HOST || '127.0.0.1',port:Number(process.env.QA_PORT || 3211)});
console.log(`Isolated browser QA ready on ${process.env.QA_HOST || '127.0.0.1'}:${process.env.QA_PORT || 3211}; in-memory test data only`);
