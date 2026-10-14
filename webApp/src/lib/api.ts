const apiBase = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api").replace(/\/$/, "")
const authUrl = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "")
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ""

export type Session = { access_token: string; refresh_token: string; expires_at?: number; user: { id: string; email: string } }
export type Company = { id: string; legal_name: string; display_name: string; slug: string; status: string; roles?: string[] }
export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code }
}

const read = <T,>(key: string): T | null => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null } catch { return null } }
export const getSession = () => read<Session>("orbit.session")
export const setSession = (session: Session) => localStorage.setItem("orbit.session", JSON.stringify(session))
export const clearSession = () => { localStorage.removeItem("orbit.session"); localStorage.removeItem("orbit.company") }
export const getCompanyId = () => localStorage.getItem("orbit.company") || ""
export const setCompanyId = (id: string) => localStorage.setItem("orbit.company", id)

async function authRequest<T>(path: string, body: unknown): Promise<T> {
  if (!authUrl || !anonKey) throw new ApiError("Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign in.", 503)
  const response = await fetch(`${authUrl}/auth/v1/${path}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: anonKey }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(result.msg || result.message || result.error_description || result.error || "Authentication request failed", response.status)
  return result as T
}
export async function signIn(email: string, password: string) {
  const session = await authRequest<Session>("token?grant_type=password", { email, password })
  setSession(session); return session
}
export async function signUp(email: string, password: string) {
  return authRequest<{ id?: string; email?: string; message?: string }>("signup", { email, password })
}
export async function recoverPassword(email: string) {
  return authRequest<{ message?: string }>("recover", { email })
}
export async function signOut() {
  const session = getSession()
  if (session?.access_token && authUrl && anonKey) {
    await fetch(`${authUrl}/auth/v1/logout`, { method: "POST", headers: { apikey: anonKey, authorization: `Bearer ${session.access_token}` } }).catch(() => undefined)
  }
  clearSession()
}

let refreshPromise: Promise<Session | null> | null = null
async function refreshSession() {
  if (refreshPromise) return refreshPromise
  const session = getSession()
  if (!session?.refresh_token) return null
  refreshPromise = authRequest<Session>("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
    .then(next => { setSession(next); return next }).catch(() => { clearSession(); return null }).finally(() => { refreshPromise = null })
  return refreshPromise
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let session = getSession()
  if (session?.expires_at && session.expires_at * 1000 < Date.now() + 20_000) session = await refreshSession() || session
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
  const companyId = getCompanyId()
  if (companyId) headers.set("X-Company-Id", companyId)
  let response: Response
  try { response = await fetch(`${apiBase}${path.startsWith("/") ? path : `/${path}`}`, { ...init, headers }) }
  catch { throw new ApiError("Could not reach the API. Check that the backend is running and try again.", 0, "NETWORK_ERROR") }
  if (response.status === 401 && retry && session?.refresh_token) {
    const renewed = await refreshSession()
    if (renewed) return api<T>(path, init, false)
    clearSession()
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = payload.error
    throw new ApiError(typeof error === "string" ? error : error?.message || "The request could not be completed", response.status, error?.code)
  }
  return payload as T
}

export type Employee = { id: string; employee_code: string; first_name: string; last_name: string; email: string; department_id?: string | null; department_name?: string | null; designation_id?: string | null; designation_title?: string | null; manager_id?: string | null; manager_name?: string | null; location_id?: string | null; location_name?: string | null; employment_status: string; joining_date: string }
export type Department = { id: string; name: string; description?: string | null }
export type OnboardingProcess = { id: string; employee_id: string; employee_code: string; first_name: string; last_name: string; status: string; calculated_progress: number; overdue_tasks: number }
