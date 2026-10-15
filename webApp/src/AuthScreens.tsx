import { useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle, Orbit, ShieldCheck, Users } from 'lucide-react'
import { ApiError, api, recoverPassword, setCompanyId, signIn, signUp, type Company, type Session } from './lib/api'

function Brand() { return <div className="auth-brand"><span className="auth-brand-mark"><Orbit size={21}/></span><span>orbit<span>.</span></span></div> }

export function AuthScreen({ onSession, onBack }: { onSession: (session: Session) => void; onBack?: () => void }) {
  const [mode, setMode] = useState<'login'|'signup'|'recovery'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      if (mode === 'login') onSession(await signIn(email, password))
      else if (mode === 'signup') { const result = await signUp(email, password); setMessage(result.message || 'Check your email for a verification link, then return here to sign in.'); setMode('login') }
      else { await recoverPassword(email); setMessage('If that address has an account, a password reset link is on its way.') }
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Authentication failed') }
    finally { setBusy(false) }
  }
  return <main className="auth-page min-h-screen grid place-items-center bg-slate-50 px-4 py-7"><div className="auth-card w-full max-w-md rounded-2xl bg-white shadow-xl">{onBack&&<button className="auth-back-home" onClick={onBack}>← Back to home</button>}<Brand/><div className="auth-icon"><ShieldCheck size={19}/></div><div className="section-kicker">PEOPLE OPERATIONS</div><h1>{mode==='login'?'Welcome back':mode==='signup'?'Create your account':'Reset your password'}</h1><p>{mode==='login'?'Sign in to continue to your workspace.':mode==='signup'?'Use your work email to get started.':'We’ll send you a secure reset link.'}</p><form onSubmit={submit}><label>Work email<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></label>{mode!=='recovery'&&<label>Password<input type="password" required minLength={8} autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label>}{error&&<div className="auth-error" role="alert">{error}</div>}{message&&<div className="auth-message" role="status">{message}</div>}<button className="primary-button auth-submit" disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:null}{mode==='login'?'Sign in':mode==='signup'?'Create account':'Send reset link'}{!busy&&<ArrowRight size={15}/>}</button></form><div className="auth-switch">{mode==='login'?<><button onClick={()=>{setMode('recovery');setMessage('')}}>Forgot password?</button><span>·</span><button onClick={()=>{setMode('signup');setMessage('')}}>Create account</button></>:<button onClick={()=>{setMode('login');setMessage('');setError('')}}>Back to sign in</button>}</div><div className="auth-foot"><Users size={14}/> Secure sign-in powered by Supabase Auth</div></div></main>
}

export function CompanyRegistration({ onCreated }: { onCreated: (company: Company) => void }) {
  const [form, setForm] = useState({ legal_name:'',display_name:'',industry:'',company_size:'',official_email:'',country:'',headquarters:'',contact_phone:'' })
  const [busy,setBusy]=useState(false);const [error,setError]=useState('')
  const update=(key:keyof typeof form,value:string)=>setForm(previous=>({...previous,[key]:value}))
  const submit=async(event:FormEvent)=>{event.preventDefault();setBusy(true);setError('');try{const result=await api<{company:Company}>('/companies',{method:'POST',body:JSON.stringify(form)});setCompanyId(result.company.id);onCreated(result.company)}catch(e){setError(e instanceof ApiError?e.message:'Company registration failed')}finally{setBusy(false)}}
  return <main className="auth-page min-h-screen grid place-items-center bg-slate-50 px-4 py-7"><div className="auth-card company-card w-full max-w-2xl rounded-2xl bg-white shadow-xl"><Brand/><div className="section-kicker">YOUR COMPANY WORKSPACE</div><h1>Let’s set up your company</h1><p>Your verified account will become the first company owner.</p><form onSubmit={submit}><div className="auth-form-grid"><label>Legal company name<input required maxLength={160} value={form.legal_name} onChange={e=>update('legal_name',e.target.value)} placeholder="Northstar Studio, Inc."/></label><label>Display name<input required maxLength={160} value={form.display_name} onChange={e=>update('display_name',e.target.value)} placeholder="Northstar Studio"/></label><label>Official email<input required type="email" value={form.official_email} onChange={e=>update('official_email',e.target.value)} placeholder="you@company.com"/></label><label>Country<input required value={form.country} onChange={e=>update('country',e.target.value)} placeholder="Country"/></label><label>Industry<input value={form.industry} onChange={e=>update('industry',e.target.value)} placeholder="Technology"/></label><label>Company size<select value={form.company_size} onChange={e=>update('company_size',e.target.value)}><option value="">Select size</option><option>1-10</option><option>11-50</option><option>51-200</option><option>201-1000</option><option>1000+</option></select></label><label>Headquarters<input value={form.headquarters} onChange={e=>update('headquarters',e.target.value)} placeholder="City, region"/></label><label>Contact phone<input value={form.contact_phone} onChange={e=>update('contact_phone',e.target.value)} placeholder="+1 555 0100"/></label></div>{error&&<div className="auth-error" role="alert">{error}</div>}<button className="primary-button auth-submit" disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:'Create secure workspace'}{!busy&&<ArrowRight size={15}/>}</button></form><div className="auth-foot"><ShieldCheck size={14}/> Company data is separated by membership and permissions</div></div></main>
}

export function CompanyPicker({ companies, onChoose, onAdd }: { companies: Company[]; onChoose:(company:Company)=>void; onAdd:()=>void }) {
  return <main className="auth-page min-h-screen grid place-items-center bg-slate-50 px-4 py-7"><div className="auth-card w-full max-w-md rounded-2xl bg-white shadow-xl"><Brand/><div className="section-kicker">SELECT A WORKSPACE</div><h1>Where are we headed?</h1><p>Your account belongs to more than one company.</p><div className="company-list">{companies.map(company=><button key={company.id} className="company-choice" onClick={()=>onChoose(company)}><span className="company-choice-icon">{company.display_name.slice(0,1).toUpperCase()}</span><span><b>{company.display_name}</b><small>{company.legal_name}</small></span><ArrowRight size={16}/></button>)}</div><button className="outline-button company-add" onClick={onAdd}>Register another company</button></div></main>
}
