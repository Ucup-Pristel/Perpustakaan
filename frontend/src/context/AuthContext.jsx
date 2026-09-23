/**
 * AuthContext — JWT auth state: user, token, login, register, logout
 *
 * Token disimpan di localStorage; semua page akses via useAuth().
 *
 * Dua hal yang ditangani di sini dan tidak boleh hilang:
 *  1. Token kadaluarsa dibuang saat init. Tanpa ini UI tampak login sementara
 *     setiap request gagal 401 dan pengguna tidak tahu kenapa.
 *  2. Handler 401 global dipasang ke apiFetch, jadi sesi yang dicabut/expired
 *     otomatis logout dari satu tempat, bukan di tiap komponen.
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { apiFetch, isTokenExpired, setUnauthorizedHandler } from '../lib/api'

const AuthContext = createContext(null)

// Baca token dari localStorage tapi tolak yang sudah kadaluarsa.
function readStoredAuth() {
  const token = localStorage.getItem('token')
  if (!token || isTokenExpired(token)) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    return { token: null, user: null }
  }
  try {
    return { token, user: JSON.parse(localStorage.getItem('user')) }
  } catch {
    return { token, user: null }
  }
}

export function AuthProvider({ children }) {
  const [{ token, user }, setAuth] = useState(readStoredAuth)

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setAuth({ token: null, user: null })
  }, [])

  // apiFetch memanggil ini saat 401 / token expired.
  useEffect(() => {
    setUnauthorizedHandler(logout)
    return () => setUnauthorizedHandler(null)
  }, [logout])

  const login = useCallback(async (email, password) => {
    const json = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    localStorage.setItem('token', json.token)
    localStorage.setItem('user', JSON.stringify(json.data))
    setAuth({ token: json.token, user: json.data })
    return json.data
  }, [])

  const register = useCallback(async (email, password, full_name) => {
    const json = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name }),
    })
    return json.data
  }, [])

  const value = {
    user,
    token,
    login,
    register,
    logout,
    isAuthenticated: Boolean(token),
    // Role dari token hanya untuk tampilan. Backend tetap yang menegakkan izin.
    isAdmin: user?.role === 'admin',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
