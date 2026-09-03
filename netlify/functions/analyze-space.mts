const MAX_IMAGE_CHARS=2_500_000;
const VALID_SPACES=new Set(["Pantry","Fridge","Freezer","Garage","Bathroom","Storage"]);
const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8"}});
function outputText(p:any){if(typeof p?.output_text==='string')return p.output_text;for(const i of p?.output||[])for(const c of i?.content||[])if(c?.type==='output_text')return c.text||'';return''}
export default async(req:Request)=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const apiKey=Netlify.env.get("OPENAI_API_KEY")||Netlify.env.get("gotit_API_KEY");
  if(!apiKey)return json({error:"AI scanning is not connected. Add a valid OpenAI API key in Netlify."},503);
  try{
    const body=await req.json();
    const image=typeof body?.image==='string'?body.image:'';
    const space=VALID_SPACES.has(body?.space)?body.space:'Storage';
    if(!image.startsWith('data:image/'))return json({error:'Please take or choose a photo first.'},400);
    if(image.length>MAX_IMAGE_CHARS)return json({error:'That photo is too large. Try a closer photo.'},413);
    const schema={type:'object',additionalProperties:false,properties:{items:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},category:{type:'string'},quantity_estimate:{type:'integer',minimum:1,maximum:99},stock_state:{type:'string',enum:['low','plenty']},confidence:{type:'string',enum:['high','medium','low']},evidence:{type:'string'}},required:['name','category','quantity_estimate','stock_state','confidence','evidence']}}},required:['items']};
    const prompt=`Analyze this ${space} photo conservatively for household inventory. Return ONLY items actually visible. Never infer typical items. Do not claim contents hidden inside opaque containers. Do not invent brands you cannot read. quantity_estimate means visible packages/units only. high confidence = clear; medium = partly obscured; low = ambiguous. stock_state is low only when visibly near-empty/small quantity, otherwise plenty. Briefly describe visual evidence. If nothing is clearly identifiable, return an empty items array.`;
    const model=Netlify.env.get('OPENAI_VISION_MODEL')||'gpt-5.6-luna';
    const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({model,input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:image,detail:'high'}]}],text:{format:{type:'json_schema',name:'household_inventory_scan',strict:true,schema}}})});
    const payload=await upstream.json();
    if(!upstream.ok){
      console.error('OpenAI scan error',upstream.status,payload?.error?.message||payload);
      const code=payload?.error?.code||payload?.error?.type||'';
      if(upstream.status===401)return json({error:'The OpenAI API key is invalid or expired.'},502);
      if(upstream.status===429)return json({error:'The AI account has hit a usage or billing limit. Check OpenAI API billing.'},502);
      if(code==='model_not_found')return json({error:`The configured AI model (${model}) is not available to this API account.`},502);
      return json({error:'The AI scan service could not analyze that photo. Please try again.'},502);
    }
    const text=outputText(payload);
    if(!text)return json({error:'The AI scan returned no usable result. Try a clearer photo.'},502);
    return json({items:JSON.parse(text).items||[]});
  }catch(e){console.error('Analyze-space failed',e);return json({error:'Something went wrong analyzing this photo. Nothing was saved.'},500)}
};
export const config={path:'/api/analyze-space'};
