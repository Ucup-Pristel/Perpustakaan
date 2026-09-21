/**
 * AuthContext — JWT auth state: user, token, login, register, logout
 * Token disimpan di localStorage; semua page bisa akses via useAuth()
 */
import { createContext, useContext, useState, useCallback } from 'react'
import { API_URL } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [user,  setUser]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.message || 'Login gagal')
    localStorage.setItem('token', json.token)
    localStorage.setItem('user', JSON.stringify(json.data))
    setToken(json.token)
    setUser(json.data)
    return json.data
  }, [])

  const register = useCallback(async (email, password, full_name) => {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.message || 'Registrasi gagal')
    return json.data
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
