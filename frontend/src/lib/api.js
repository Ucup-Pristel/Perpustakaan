// Base URL backend API — dev pakai proxy Vite (relatif), production default ke domain API asli
export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '' : 'https://api.edulib.id')

// Decode payload JWT tanpa verifikasi tanda tangan. HANYA untuk cek kedaluwarsa
// di sisi UI — otorisasi sebenarnya tetap milik backend. Jangan pernah percaya
// isi token ini untuk keputusan keamanan.
export function decodeToken(token) {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

// Token kadaluarsa dideteksi SEBELUM request dikirim, supaya UI tidak terlihat
// login padahal setiap panggilan diam-diam gagal.
export function isTokenExpired(token) {
  const payload = decodeToken(token)
  if (!payload?.exp) return false // tanpa exp: biarkan backend yang memutuskan
  return payload.exp * 1000 <= Date.now()
}

// Dipasang oleh AuthContext. Dipanggil saat backend membalas 401 atau token sudah
// kadaluarsa, supaya state auth tidak tertinggal basi di localStorage.
let onUnauthorized = null
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Wrapper fetch tunggal untuk semua panggilan API.
 *
 * Alasan ada: sebelumnya setiap komponen memanggil fetch sendiri, jadi respons 401
 * (token kadaluarsa atau role dicabut) hanya memunculkan pesan error generik —
 * pengguna tetap terlihat login sementara semua aksi gagal. Di sini 401 memicu
 * logout, sekali, di satu tempat.
 *
 * @param {string} path  contoh: '/api/contents'
 * @param {object} opts  { token, signal, method, body, headers }
 */
export async function apiFetch(path, { token, headers, ...opts } = {}) {
  const finalHeaders = { ...headers }

  if (token) {
    if (isTokenExpired(token)) {
      onUnauthorized?.()
      throw new ApiError('Sesi berakhir. Silakan masuk kembali.', 401)
    }
    finalHeaders.Authorization = `Bearer ${token}`
  }

  // FormData menentukan boundary-nya sendiri — jangan set Content-Type manual.
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData
  if (opts.body && !isForm && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json'
  }

  let res
  try {
    res = await fetch(`${API_URL}${path}`, { ...opts, headers: finalHeaders })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ApiError('Tidak dapat menghubungi server. Cek koneksi internet.', 0)
  }

  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiError('Sesi berakhir. Silakan masuk kembali.', 401)
  }

  // 429 punya penyebab spesifik; pesan generik membuat pengguna mengira app rusak.
  if (res.status === 429) {
    throw new ApiError('Terlalu banyak permintaan. Coba lagi beberapa saat lagi.', 429)
  }

  let json = null
  try {
    json = await res.json()
  } catch {
    throw new ApiError(res.ok ? 'Respons server tidak valid' : `Server membalas ${res.status}`, res.status)
  }

  if (!res.ok) throw new ApiError(json?.message || `Server membalas ${res.status}`, res.status)
  return json
}
