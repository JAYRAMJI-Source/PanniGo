require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const cookieSession=require('cookie-session');
const crypto=require('crypto');
const Razorpay=require('razorpay');
const {createClient}=require('@supabase/supabase-js');

const app=express();
const PORT=Number(process.env.PORT||3000);
const isProd=process.env.NODE_ENV==='production';
const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PAANIGO_ADMIN_PASSWORD','SESSION_SECRET'];
if(required.some(k=>!process.env[k])){console.error('Missing required environment variables:',required.filter(k=>!process.env[k]).join(', '));process.exit(1)}
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const razorpay=(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET)?new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'100kb'}));
app.use(cookieSession({name:'paanigo_session',keys:[process.env.SESSION_SECRET],httpOnly:true,sameSite:'lax',secure:isProd,maxAge:8*60*60*1000}));
const publicLimiter=rateLimit({windowMs:60*1000,max:100,standardHeaders:true,legacyHeaders:false});
const orderLimiter=rateLimit({windowMs:10*60*1000,max:20,message:{error:'Too many order attempts. Please try again later.'}});
const adminLimiter=rateLimit({windowMs:15*60*1000,max:30,message:{error:'Too many admin requests. Please try again later.'}});
app.use('/api/',publicLimiter);
function admin(req,res,next){if(!req.session?.admin)return res.status(401).json({error:'Unauthorized'});next()}
function clean(x,max){return String(x??'').trim().slice(0,max)}
function validPhone(p){return /^\+?[0-9\s-]{10,15}$/.test(p)}
function code(){return 'PG'+Date.now().toString().slice(-8)+crypto.randomInt(10,99)}
async function getProducts(){const {data,error}=await supabase.from('products').select('id,name,price_inr').eq('active',true).order('name');if(error)throw error;return data||[]}
async function getZones(){const {data,error}=await supabase.from('delivery_zones').select('id,name').eq('active',true).order('name');if(error)throw error;return data||[]}
app.get('/api/health',async(req,res)=>{try{await getProducts();res.json({ok:true,service:'paanigo',version:'7.0.0'})}catch(e){res.status(503).json({ok:false})}});
app.get('/api/products',async(req,res)=>{
  try{
    res.json({products:await getProducts()});
  }catch(e){
    console.error('PRODUCT ERROR:',e);
    res.status(500).json({error:e.message});
  }
});
app.get('/api/zones',async(req,res)=>{try{res.json({zones:await getZones()})}catch(e){res.status(500).json({error:'Unable to load delivery zones'})}});
app.post('/api/orders',orderLimiter,async(req,res)=>{try{const name=clean(req.body.name,80),phone=clean(req.body.phone,20),address=clean(req.body.address,500),payment=clean(req.body.payment,30)||'Cash on Delivery',items=Array.isArray(req.body.items)?req.body.items:[];if(!name||!address||!validPhone(phone)||!items.length)return res.status(400).json({error:'Please provide valid customer details and at least one item.'});const products=await getProducts();const map=new Map(products.map(p=>[p.name,p]));let total=0;const cleanItems=[];for(const item of items){const p=map.get(clean(item.n,80));const q=Number(item.q);if(!p||!Number.isInteger(q)||q<1||q>50)throw new Error('Invalid item');total+=p.price_inr*q;cleanItems.push({product_id:p.id,name:p.name,quantity:q,unit_price_inr:p.price_inr})}const orderCode=code();let razorpayOrderId=null;if(payment!=='Cash on Delivery'){if(!razorpay)return res.status(503).json({error:'Online payment is not configured yet. Please choose Cash on Delivery.'});const rp=await razorpay.orders.create({amount:total*100,currency:'INR',receipt:orderCode});razorpayOrderId=rp.id}
const {data,error}=await supabase.from('orders').insert({order_code:orderCode,customer_name:name,phone,address,payment_method:payment,payment_status:payment==='Cash on Delivery'?'pending':'created',status:'New',total_inr:total,items:cleanItems,razorpay_order_id:razorpayOrderId}).select('*').single();if(error)throw error;res.status(201).json({order:{id:data.order_code,name:data.customer_name,phone:data.phone,address:data.address,payment:data.payment_method,total:data.total_inr,status:data.status,items:cleanItems},payment:razorpayOrderId?{keyId:process.env.RAZORPAY_KEY_ID,orderId:razorpayOrderId,amount:total*100,currency:'INR'}:null})}catch(e){console.error(e);res.status(400).json({error:'Unable to place order'})}});
app.get('/api/orders/:code',async(req,res)=>{const {data,error}=await supabase.from('orders').select('order_code,customer_name,total_inr,status,payment_status,items,created_at').eq('order_code',clean(req.params.code,30)).maybeSingle();if(error||!data)return res.status(404).json({error:'Order not found'});res.json({order:{id:data.order_code,total:data.total_inr,status:data.status,paymentStatus:data.payment_status,items:data.items,createdAt:data.created_at}})});
app.post('/api/admin/login',adminLimiter,(req,res)=>{const supplied=Buffer.from(String(req.body.password||''));const expected=Buffer.from(process.env.PAANIGO_ADMIN_PASSWORD);if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return res.status(401).json({error:'Invalid password'});req.session.admin=true;res.json({ok:true})});
app.post('/api/admin/logout',admin,(req,res)=>{req.session=null;res.json({ok:true})});
app.get('/api/admin/orders',admin,async(req,res)=>{const {data,error}=await supabase.from('orders').select('*').order('created_at',{ascending:false});if(error)return res.status(500).json({error:'Unable to load orders'});res.json({orders:data})});
app.patch('/api/admin/orders/:code',admin,async(req,res)=>{const allowed=['New','Confirmed','Out for Delivery','Delivered','Cancelled'];if(!allowed.includes(req.body.status))return res.status(400).json({error:'Invalid status'});const {data,error}=await supabase.from('orders').update({status:req.body.status,updated_at:new Date().toISOString()}).eq('order_code',clean(req.params.code,30)).select('*').single();if(error||!data)return res.status(404).json({error:'Order not found'});res.json({order:data})});
app.get('/api/admin/zones',admin,async(req,res)=>{res.json({zones:await getZones()})});
app.post('/api/admin/zones',admin,async(req,res)=>{const name=clean(req.body.zone,100);if(!name)return res.status(400).json({error:'Zone required'});const {error}=await supabase.from('delivery_zones').upsert({name,active:true},{onConflict:'name'});if(error)return res.status(400).json({error:'Unable to save zone'});res.status(201).json({zones:await getZones()})});
app.delete('/api/admin/zones/:id',admin,async(req,res)=>{const {error}=await supabase.from('delivery_zones').update({active:false}).eq('id',req.params.id);if(error)return res.status(400).json({error:'Unable to remove zone'});res.json({zones:await getZones()})});
app.get('/api/admin/export',admin,async(req,res)=>{const {data,error}=await supabase.from('orders').select('*').order('created_at',{ascending:false});if(error)return res.status(500).json({error:'Unable to export'});res.json({orders:data,exportedAt:new Date().toISOString()})});
app.post('/api/payments/verify',async(req,res)=>{const {orderCode,razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body; if(!process.env.RAZORPAY_KEY_SECRET)return res.status(503).json({error:'Payments not configured'});const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');if(expected!==razorpay_signature)return res.status(400).json({error:'Invalid payment signature'});const {error}=await supabase.from('orders').update({payment_status:'paid',razorpay_payment_id,updated_at:new Date().toISOString()}).eq('order_code',clean(orderCode,30));if(error)return res.status(500).json({error:'Unable to update payment'});res.json({ok:true})});
app.use(express.static('public'));
app.use((req,res)=>res.status(404).send('Not found'));
app.listen(PORT,'0.0.0.0',()=>console.log(`PaaniGo V7 listening on ${PORT}`));
