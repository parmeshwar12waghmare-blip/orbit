import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowDownUp, ArrowRight, BriefcaseBusiness, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Command, Download, Ellipsis, LayoutDashboard, ListChecks, Menu, MoreHorizontal, Plus, Search, Settings2, Shield, Sparkles, Users, UserPlus, ClipboardCheck, ScrollText, X } from 'lucide-react'
import { ApiError, api, clearSession, getCompanyId, getSession, setCompanyId, signOut, type Company, type Department, type Employee, type Session } from './lib/api'
import { AuthScreen, CompanyPicker, CompanyRegistration } from './AuthScreens'
import { ApprovalsPage, AuditPage, DepartmentsPage, InvitationsPage, OnboardingPage, RolesPage, SettingsPage } from './WorkspacePages'

const navGroups = [
  { title: 'WORKSPACE', links: [{ label: 'Overview', icon: LayoutDashboard }, { label: 'People', icon: Users }, { label: 'Onboarding', icon: ListChecks }, { label: 'Approvals', icon: ClipboardCheck }, { label: 'Invitations', icon: UserPlus }] },
  { title: 'MANAGE', links: [{ label: 'Departments', icon: BriefcaseBusiness }, { label: 'Roles & permissions', icon: Shield }, { label: 'Audit log', icon: ScrollText }, { label: 'Company settings', icon: Settings2 }] },
]
const palette = ['#f0bfad', '#e9c1dd', '#c3d9c3', '#d7c8f4', '#f3d8a2', '#bfdbe8']
const initials = (e: Employee) => `${e.first_name[0]}${e.last_name[0]}`
const formatDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function App() {
  const [session, setSession] = useState<Session | null>(getSession)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyIdState] = useState(getCompanyId)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [templates, setTemplates] = useState<Array<{id:string;name:string}>>([])
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [onboardingCount, setOnboardingCount] = useState(0)
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [dataError, setDataError] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 25
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All people')
  const [sortNewest, setSortNewest] = useState(true)
  const [modal, setModal] = useState(false)
  const [toast, setToast] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activePage, setActivePage] = useState('People')
  const [apiConnected, setApiConnected] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', employee_code: '', department_id: '', joining_date: '', onboarding_template_id:'' })

  useEffect(() => {
    if (!session) return
    let active = true
    api<{ data: Company[] }>('/companies').then(result => {
      if (!active) return
      setCompanies(result.data)
      if (companyId && result.data.some(company => company.id === companyId)) return
      if (result.data.length === 1) { setCompanyId(result.data[0].id); setCompanyIdState(result.data[0].id) }
      else { setCompanyId(''); setCompanyIdState('') }
    }).catch(error => { if (active) { setDataError(error instanceof Error ? error.message : 'Could not load companies'); if (error instanceof ApiError && error.status === 401) { clearSession(); setSession(null) } } })
    return () => { active = false }
  }, [session?.access_token])

  useEffect(() => {
    if (!session || !companyId) return
    let active = true
    api<{ data: Department[] }>('/departments').then(result => { if (active) setDepartments(result.data) }).catch(() => undefined)
    api<{ data: Array<{id:string;name:string}> }>('/onboarding/templates').then(result => { if (active) setTemplates(result.data) }).catch(() => undefined)
    api<{ data: Array<unknown> }>('/onboarding').then(result => { if (active) setOnboardingCount(result.data.length) }).catch(() => { if (active) setOnboardingCount(0) })
    return () => { active = false }
  }, [session?.access_token, companyId])

  useEffect(() => {
    if (!session || !companyId) return
    let active = true
    const timer = window.setTimeout(() => {
      setLoadingEmployees(true); setDataError('')
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize), sort_by: 'joining_date', sort_order: sortNewest ? 'desc' : 'asc' })
      if (query.trim()) params.set('q', query.trim())
      if (filter === 'Onboarding') params.set('status', 'preboarding')
      if (filter === 'Active') params.set('status', 'active')
      api<{ data: Employee[]; pagination: { total: number } }>(`/employees?${params}`).then(result => {
        if (active) { setEmployees(result.data); setTotalEmployees(result.pagination.total); setApiConnected(true) }
      }).catch(error => {
        if (active) { setEmployees([]); setTotalEmployees(0); setApiConnected(false); setDataError(error instanceof Error ? error.message : 'Could not load employees'); if (error instanceof ApiError && error.status === 401) { clearSession(); setSession(null) } }
      }).finally(() => { if (active) setLoadingEmployees(false) })
    }, 220)
    return () => { active = false; window.clearTimeout(timer) }
  }, [session?.access_token, companyId, query, filter, sortNewest, page, reload])

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }
  const addPerson = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true); setFormError('')
    try {
      await api('/employees', { method: 'POST', body: JSON.stringify({ ...form, department_id: form.department_id || null, onboarding_template_id: form.onboarding_template_id || null, employment_status: 'preboarding' }) })
      setModal(false); setForm({ first_name: '', last_name: '', email: '', employee_code: '', department_id: '', joining_date: '', onboarding_template_id:'' }); setReload(value => value + 1); notify('New employee saved')
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Could not add employee') }
    finally { setSubmitting(false) }
  }

  if (!session) return <AuthScreen onSession={next => { setSession(next); setDataError('') }} />
  const selectedCompany = companies.find(company => company.id === companyId)
  if (dataError && companies.length === 0 && !companyId) return <div className="auth-page"><div className="auth-card"><div className="section-kicker">WORKSPACE CONNECTION</div><h1>Couldnâ€™t load your companies</h1><p>{dataError}</p><button className="primary-button auth-submit" onClick={() => { setDataError(''); setCompanies([]); setReload(value => value + 1) }}>Try again</button><button className="auth-switch" onClick={async()=>{await signOut();setSession(null)}}>Sign out</button></div></div>
  if (!companyId) return companies.length > 1 ? <CompanyPicker companies={companies} onAdd={()=>setCompanies([])} onChoose={company=>{setCompanyId(company.id);setCompanyIdState(company.id)}} /> : <CompanyRegistration onCreated={company=>{setCompanies([company]);setCompanyIdState(company.id);setDataError('')}} />

  return <div className="app-shell">
    {sidebarOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#home" aria-label="Orbit home"><span className="brand-mark"><span /></span><span className="brand-name">orbit<span className="brand-dot">.</span></span></a>
      <button className="workspace-switch" onClick={()=>{if(companies.length>1){setCompanyId('');setCompanyIdState('')}else notify('This account currently has one company workspace')}}><div className="workspace-icon">{selectedCompany?.display_name.slice(0,1).toUpperCase() || 'O'}</div><div className="workspace-copy"><b>{selectedCompany?.display_name || 'Company workspace'}</b><span>{selectedCompany?.legal_name || 'Select a workspace'}</span></div><ChevronDown size={15} /></button>
      <div className="side-scroll">
        {navGroups.map(group => <section className="nav-group" key={group.title}><div className="section-label">{group.title}</div>{group.links.map(item => { const Icon = item.icon; const active = item.label === activePage || (item.label === 'Overview' && activePage === 'People'); return <button className={`nav-link ${active ? 'active' : ''}`} key={item.label} onClick={() => {setActivePage(item.label==='Overview'?'People':item.label);setSidebarOpen(false)}}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span></button>})}</section>)}
        <div className="side-upgrade"><div className="upgrade-icon"><Sparkles size={17} /></div><b>Your people,<br />in one place.</b><p>Make the busywork feel like less work.</p><button onClick={() => notify('Youâ€™re all set â€” enjoy Orbit')}>Explore Orbit <ArrowRight size={14} /></button><span className="upgrade-orbit orb-one" /><span className="upgrade-orbit orb-two" /></div>
      </div>
      <div className="sidebar-bottom"><button className="nav-link" onClick={()=>notify('Ask your company administrator for workspace support')}><CircleHelp size={17} /><span>Help center</span></button><button className="nav-link" onClick={()=>notify('Company settings are available to company administrators')}><Settings2 size={17} /><span>Settings</span></button><button className="profile profile-button" onClick={async()=>{await signOut();setSession(null);setCompanies([]);setCompanyIdState('')}}><div className="avatar avatar-profile">{session.user.email.slice(0,1).toUpperCase()}</div><div className="profile-copy"><b>{session.user.email}</b><span>Sign out</span></div><MoreHorizontal size={19} /></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={19} /></button><div className="breadcrumbs"><span>{selectedCompany?.display_name || 'Workspace'}</span><ChevronRight size={14} /><b>{activePage}</b></div><div className="topbar-actions"><button className="search-shortcut" disabled={activePage!=='People'} onClick={() => document.getElementById('people-search')?.focus()}><Search size={15} /><span>Search people...</span><kbd><Command size={11} /> K</kbd></button><div className="topbar-divider" /><div className="avatar avatar-profile top-avatar" title={session.user.email}>{session.user.email.slice(0,1).toUpperCase()}</div></div></header>
      <div className="page-content min-h-screen">
        {activePage==='People'?<>
        <div className="welcome-row"><div><div className="eyebrow"><span className="live-dot" /> PEOPLE OPERATIONS <span className="eyebrow-slash">/</span> OVERVIEW</div><h1>Your people, <span>in orbit.</span></h1><p className="subtitle">A snapshot of the people in {selectedCompany?.display_name}.</p></div><div className="date-chip"><CalendarDays size={15} /> <span>{new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</span></div></div>
        <div className="stats-grid stats-live">
          <article className="stat-card stat-primary"><div className="stat-top"><span>People in this workspace</span><span className="stat-icon"><Users size={17} /></span></div><div className="stat-number">{loadingEmployees?'â€”':totalEmployees}</div><div className="stat-note"><span className="note-dot green" /> Live employee records</div></article>
          <article className="stat-card"><div className="stat-top"><span>Onboarding processes</span><span className="stat-icon lavender"><ListChecks size={17} /></span></div><div className="stat-number">{onboardingCount}<span className="stat-unit">in this company</span></div><div className="stat-note"><span className="note-dot purple" /> Calculated from saved workflows</div></article>
        </div>
        <section className="people-section"><div className="section-heading"><div><div className="section-kicker">THE CREW</div><h2>People <span className="count-pill">{totalEmployees}</span></h2></div><div className="heading-actions"><button className="outline-button" onClick={async()=>{try{const result=await api<{data:Employee[]}>('/employees?limit=100&offset=0');const rows=[['Employee ID','First name','Last name','Email','Department','Job title','Status','Joining date'],...result.data.map(e=>[e.employee_code,e.first_name,e.last_name,e.email,e.department_name||'',e.designation_title||'',e.employment_status,e.joining_date])];const csv=rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const link=document.createElement('a');link.href=url;link.download='employees.csv';link.click();URL.revokeObjectURL(url)}catch(error){notify(error instanceof Error?error.message:'Export failed')}}}><Download size={15} /><span>Export page</span></button><button className="primary-button" onClick={() => {setFormError('');setModal(true)}}><Plus size={16} /><span>Add a person</span></button></div></div>
          <div className="table-tools"><div className="tabs">{['All people','Onboarding','Active'].map(tab => <button key={tab} className={`tab ${filter===tab?'selected':''}`} onClick={() => {setFilter(tab);setPage(0)}}>{tab}{tab==='Onboarding' && <span>{onboardingCount}</span>}</button>)}</div><div className="table-actions"><label className="table-search"><Search size={15} /><input id="people-search" placeholder="Search people..." value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}} /><kbd>/</kbd></label><button className="square-button" title="Sort by start date" onClick={() => setSortNewest(!sortNewest)}><ArrowDownUp size={15} /></button></div></div>
          {dataError&&<div className="data-error" role="alert">{dataError}<button onClick={()=>setReload(value=>value+1)}>Retry</button></div>}
          <div className="table-wrap"><table><thead><tr><th></th><th>NAME <ArrowDown size={12} /></th><th>DEPARTMENT</th><th>STATUS</th><th>START DATE <ArrowDown size={12} /></th><th /></tr></thead><tbody>{employees.map((person, i) => <tr key={person.id}><td></td><td><div className="person-cell"><div className="avatar" style={{background:palette[i%palette.length]}}>{initials(person)}</div><div className="person-meta"><b>{person.first_name} {person.last_name}</b><span>{person.email}</span></div></div></td><td><div className="department"><span className={`department-dot dot-${(person.department_name ?? 'people').toLowerCase()}`} />{person.department_name ?? 'Unassigned'}<span className="role-separator">Â·</span><span className="job-title">{person.designation_title ?? 'Team member'}</span></div></td><td><span className={`status-pill ${person.employment_status === 'preboarding' ? 'status-onboarding' : 'status-active'}`}><i />{person.employment_status === 'preboarding' ? 'Onboarding' : person.employment_status === 'on_leave' ? 'On leave' : person.employment_status === 'terminated' ? 'Deactivated' : 'Active'}</span></td><td className="date-cell">{formatDate(person.joining_date)}</td><td><button className="row-more" aria-label={`Deactivate ${person.first_name}`} onClick={async()=>{if(!window.confirm(`Deactivate ${person.first_name} ${person.last_name}?`))return;try{await api(`/employees/${person.id}`,{method:'DELETE'});setReload(value=>value+1);notify('Employee deactivated')}catch(error){notify(error instanceof Error?error.message:'Could not deactivate employee')}}}><Ellipsis size={18} /></button></td></tr>)}</tbody></table>{!loadingEmployees&&employees.length===0&&<div className="empty-state"><div><Search size={19}/></div><b>{query?'No matching employees':'No employees yet'}</b><span>{query?'Try another search.':'Add your first employee to get started.'}</span>{query&&<button onClick={()=>{setQuery('');setFilter('All people')}}>Clear search</button>}</div>}{loadingEmployees&&<div className="loading-state"><span className="spinner"/>Loading employeesâ€¦</div>}</div>
          <div className="table-footer"><span>Showing <b>{totalEmployees? page*pageSize+1:0}â€“{Math.min((page+1)*pageSize,totalEmployees)}</b> of <b>{totalEmployees}</b> people</span><div className="pagination"><button disabled={page===0} aria-label="Previous page" onClick={()=>setPage(current=>Math.max(0,current-1))}><ChevronLeft size={16} /></button><span>Page {page+1} of {Math.max(1,Math.ceil(totalEmployees/pageSize))}</span><button disabled={(page+1)*pageSize>=totalEmployees} aria-label="Next page" onClick={()=>setPage(current=>current+1)}><ChevronRight size={16} /></button></div><span className="rows-select">{pageSize} per page</span></div>
        </section>
        </>:<div className="route-page-shell">{activePage==='Onboarding'?<OnboardingPage/>:activePage==='Departments'?<DepartmentsPage/>:activePage==='Roles & permissions'?<RolesPage/>:activePage==='Invitations'?<InvitationsPage/>:activePage==='Approvals'?<ApprovalsPage/>:activePage==='Audit log'?<AuditPage/>:activePage==='Company settings'?<SettingsPage/>:<section className="workspace-page"><div className="section-kicker">WORKSPACE</div><h2>{activePage}</h2><p>This module is not available in the current implementation.</p></section>}</div>}
        <footer className="page-footer"><span>Made for people, by people <span>âœ³</span></span><span className={`connection ${apiConnected?'connected':''}`}><i />{apiConnected?'Live company data':'API disconnected'}</span><span>Â© 2026 Orbit People</span></footer>
      </div>
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&setModal(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-top"><div className="modal-icon"><Users size={19}/></div><button className="icon-button" onClick={()=>setModal(false)} aria-label="Close"><X size={18}/></button></div><div className="section-kicker">GROW THE CREW</div><h2 id="modal-title">Add a new person</h2><p>Enter the employee details to create a company record.</p><form onSubmit={addPerson}><div className="form-grid"><label>First name<input required maxLength={100} value={form.first_name} onChange={e=>setForm({...form,first_name:e.target.value})} placeholder="e.g. Alex" /></label><label>Last name<input required maxLength={100} value={form.last_name} onChange={e=>setForm({...form,last_name:e.target.value})} placeholder="e.g. Morgan" /></label></div><label>Work email<input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="alex@company.com" /></label><div className="form-grid"><label>Employee ID<input required value={form.employee_code} onChange={e=>setForm({...form,employee_code:e.target.value})} placeholder="EMP-1043" /></label><label>Start date<input required type="date" value={form.joining_date} onChange={e=>setForm({...form,joining_date:e.target.value})} /></label></div><label>Department<select value={form.department_id} onChange={e=>setForm({...form,department_id:e.target.value})}><option value="">No department</option>{departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label>Onboarding workflow<select value={form.onboarding_template_id} onChange={e=>setForm({...form,onboarding_template_id:e.target.value})}><option value="">No workflow</option>{templates.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></label>{formError&&<div className="auth-error" role="alert">{formError}</div>}<div className="modal-actions"><button type="button" className="outline-button" onClick={()=>setModal(false)}>Cancel</button><button type="submit" disabled={submitting} className="primary-button">{submitting?'Savingâ€¦':<><Plus size={15}/> Add person</>}</button></div></form></section></div>}
    {toast && <div className="toast"><span><Check size={14}/></span>{toast}<button onClick={()=>setToast('')} aria-label="Dismiss"><X size={14}/></button></div>}
  </div>
}

export default App

