const express=require("express");
const path=require("path");
const Database=require("better-sqlite3");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");

const app=express();
const PORT=process.env.PORT||3000;
const SECRET=process.env.JWT_SECRET||"CHANGE_THIS_SECRET_IN_PRODUCTION";
const db=new Database(process.env.DB_PATH||"fleet.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'staff'
);
CREATE TABLE IF NOT EXISTS dispatches(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 date TEXT NOT NULL,
 vehicle TEXT NOT NULL,
 capacity REAL NOT NULL,
 driver TEXT NOT NULL,
 origin TEXT NOT NULL,
 destination TEXT NOT NULL,
 weight REAL NOT NULL,
 company TEXT NOT NULL,
 base_freight REAL NOT NULL DEFAULT 0,
 extra_rate REAL NOT NULL DEFAULT 0,
 extra_weight REAL NOT NULL DEFAULT 0,
 total_freight REAL NOT NULL DEFAULT 0,
 payment_terms TEXT NOT NULL,
 payment_status TEXT NOT NULL DEFAULT 'Pending',
 received_date TEXT,
 remarks TEXT,
 created_by INTEGER,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
 
CREATE TABLE IF NOT EXISTS backloads(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 original_dispatch_id INTEGER,
 date TEXT NOT NULL,
 vehicle TEXT NOT NULL,
 origin TEXT NOT NULL,
 destination TEXT NOT NULL,
 weight REAL NOT NULL DEFAULT 0,
 capacity REAL NOT NULL DEFAULT 40,
 company TEXT NOT NULL,
 base_freight REAL NOT NULL DEFAULT 0,
 extra_rate REAL NOT NULL DEFAULT 0,
 extra_weight REAL NOT NULL DEFAULT 0,
 extra_freight REAL NOT NULL DEFAULT 0,
 total_freight REAL NOT NULL DEFAULT 0,
 payment_terms TEXT NOT NULL,
 payment_status TEXT NOT NULL DEFAULT 'Pending',
 received_date TEXT,
 completed INTEGER NOT NULL DEFAULT 0,
 completion_date TEXT,
 remarks TEXT,
 created_by INTEGER,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(original_dispatch_id) REFERENCES dispatches(id)
);
`);

try{db.exec("ALTER TABLE backloads ADD COLUMN capacity REAL NOT NULL DEFAULT 40");}catch(e){}
try{db.exec("ALTER TABLE backloads ADD COLUMN completed INTEGER NOT NULL DEFAULT 0");}catch(e){}
try{db.exec("ALTER TABLE backloads ADD COLUMN completion_date TEXT");}catch(e){}

if(!db.prepare("SELECT 1 FROM users LIMIT 1").get()){
  const hash=bcrypt.hashSync("admin123",10);
  db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,?)").run("admin",hash,"admin");
  console.log("Default login: admin / admin123");
}

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

function auth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Login required"});
  try{req.user=jwt.verify(h.slice(7),SECRET);next()}catch(e){res.status(401).json({error:"Invalid session"})}
}
function calc(d){
  const extra=Math.max(0,Number(d.weight)-Number(d.capacity));
  const total=Number(d.base_freight||0)+extra*Number(d.extra_rate||0);
  return {extra_weight:extra,total_freight:total};
}

app.post("/api/login",(req,res)=>{
  const {username,password}=req.body;
  const u=db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if(!u||!bcrypt.compareSync(password,u.password_hash)) return res.status(401).json({error:"Invalid username or password"});
  const token=jwt.sign({id:u.id,username:u.username,role:u.role},SECRET,{expiresIn:"12h"});
  res.json({token,user:{username:u.username,role:u.role}});
});

app.get("/api/dispatches",auth,(req,res)=>{
  const rows=db.prepare("SELECT * FROM dispatches ORDER BY date DESC,id DESC").all();
  res.json(rows);
});

app.post("/api/dispatches",auth,(req,res)=>{
  const d=req.body, c=calc(d);
  const stmt=db.prepare(`INSERT INTO dispatches
  (date,vehicle,capacity,driver,origin,destination,weight,company,base_freight,extra_rate,extra_weight,total_freight,payment_terms,payment_status,received_date,remarks,created_by)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const r=stmt.run(d.date,d.vehicle,d.capacity,d.driver,d.origin,d.destination,d.weight,d.company,d.base_freight||0,d.extra_rate||0,c.extra_weight,c.total_freight,d.payment_terms,d.payment_status||"Pending",d.received_date||null,d.remarks||"",req.user.id);
  res.json({id:r.lastInsertRowid});
});

app.put("/api/dispatches/:id",auth,(req,res)=>{
  const d=req.body,c=calc(d);
  db.prepare(`UPDATE dispatches SET date=?,vehicle=?,capacity=?,driver=?,origin=?,destination=?,weight=?,company=?,base_freight=?,extra_rate=?,extra_weight=?,total_freight=?,payment_terms=?,payment_status=?,received_date=?,remarks=? WHERE id=?`)
  .run(d.date,d.vehicle,d.capacity,d.driver,d.origin,d.destination,d.weight,d.company,d.base_freight||0,d.extra_rate||0,c.extra_weight,c.total_freight,d.payment_terms,d.payment_status,d.received_date||null,d.remarks||"",req.params.id);
  res.json({ok:true});
});

app.delete("/api/dispatches/:id",auth,(req,res)=>{
  db.prepare("DELETE FROM dispatches WHERE id=?").run(req.params.id);res.json({ok:true});
});

app.get("/api/backloads",auth,(req,res)=>{
 res.json(db.prepare("SELECT b.*,d.date AS original_date FROM backloads b LEFT JOIN dispatches d ON d.id=b.original_dispatch_id ORDER BY b.date DESC,b.id DESC").all());
});
app.post("/api/backloads",auth,(req,res)=>{
 const d=req.body, extra=Math.max(0,Number(d.weight||0)-Number(d.capacity||0));
 const extraFreight=extra*Number(d.extra_rate||0), total=Number(d.base_freight||0)+extraFreight;
 const r=db.prepare(`INSERT INTO backloads(original_dispatch_id,date,vehicle,origin,destination,weight,capacity,company,base_freight,extra_rate,extra_weight,extra_freight,total_freight,payment_terms,payment_status,received_date,completed,completion_date,remarks,created_by)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.original_dispatch_id||null,d.date,d.vehicle,d.origin,d.destination,d.weight,d.capacity||40,d.company,d.base_freight||0,d.extra_rate||0,extra,extraFreight,total,d.payment_terms||"After 10 Days",d.payment_status||"Pending",d.received_date||null,d.completed?1:0,d.completion_date||null,d.remarks||"",req.user.id);
 res.json({id:r.lastInsertRowid});
});
app.put("/api/backloads/:id",auth,(req,res)=>{
 const d=req.body, extra=Math.max(0,Number(d.weight||0)-Number(d.capacity||0));
 const extraFreight=extra*Number(d.extra_rate||0), total=Number(d.base_freight||0)+extraFreight;
 db.prepare(`UPDATE backloads SET original_dispatch_id=?,date=?,vehicle=?,origin=?,destination=?,weight=?,capacity=?,company=?,base_freight=?,extra_rate=?,extra_weight=?,extra_freight=?,total_freight=?,payment_terms=?,payment_status=?,received_date=?,completed=?,completion_date=?,remarks=? WHERE id=?`)
 .run(d.original_dispatch_id||null,d.date,d.vehicle,d.origin,d.destination,d.weight,d.capacity||40,d.company,d.base_freight||0,d.extra_rate||0,extra,extraFreight,total,d.payment_terms||"After 10 Days",d.payment_status||"Pending",d.received_date||null,d.completed?1:0,d.completion_date||null,d.remarks||"",req.params.id);
 res.json({ok:true});
});
app.delete("/api/backloads/:id",auth,(req,res)=>{db.prepare("DELETE FROM backloads WHERE id=?").run(req.params.id);res.json({ok:true})});

app.get("/api/vehicles/:vehicle/report",auth,(req,res)=>{
  const rows=db.prepare("SELECT * FROM dispatches WHERE vehicle=? AND date BETWEEN COALESCE(?,date) AND COALESCE(?,date) ORDER BY date,id").all(req.params.vehicle,req.query.from||null,req.query.to||null);
  const totalWeight=rows.reduce((a,r)=>a+r.weight,0), freight=rows.reduce((a,r)=>a+r.total_freight,0);
  const pending=rows.filter(r=>r.payment_status!=="Received").reduce((a,r)=>a+r.total_freight,0);
  res.json({rows,summary:{trips:rows.length,totalWeight,freight,pending}});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Fleet portal running on port ${PORT}`));