import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

function passwordByteLength(value) {
  return new TextEncoder().encode(value).length
}

export default function ResetPassword() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { logout } = useAuth()
  const [token] = useState(() => searchParams.get('token') || '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!searchParams.has('token')) return
    const cleanedParams = new URLSearchParams(searchParams)
    cleanedParams.delete('token')
    setSearchParams(cleanedParams, { replace: true })
  }, [searchParams, setSearchParams])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!token) {
      setError('Tautan reset password tidak valid atau tidak lengkap.')
      return
    }
    if (password.length < 6) {
      setError('Password minimal 6 karakter')
      return
    }
    if (passwordByteLength(password) > 72) {
      setError('Password maksimal 72 byte')
      return
    }
    if (password !== confirmation) {
      setError('Konfirmasi password tidak cocok')
      return
    }

    setLoading(true)
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      })
      // Reset password mencabut semua JWT lama. Bersihkan sesi lokal agar UI
      // tidak tetap menampilkan akun yang tokennya sudah tidak berlaku.
      logout()
      setSuccess(true)
      setPassword('')
      setConfirmation('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-orange-50 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-orange-100 px-6 py-10 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
          <h1 className="mt-4 text-2xl font-extrabold text-amber-900">Password berhasil direset</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            Password baru sudah aktif. Silakan masuk kembali dengan password tersebut.
          </p>
          <Link to="/login" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-800">
            <ArrowLeft className="h-4 w-4" /> Ke halaman login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-orange-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-orange-100 overflow-hidden">
        <div className="bg-gradient-to-r from-amber-800 to-orange-700 px-6 py-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 mb-3">
            <KeyRound className="w-7 h-7 text-amber-800" />
          </div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Reset Password</h1>
          <p className="text-amber-200 text-sm mt-1">Buat password baru untuk akunmu</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-7 flex flex-col gap-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="new-password">
              Password baru <span className="font-normal text-gray-400">(min. 6 karakter)</span>
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="confirm-password">Konfirmasi password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmation}
              onChange={event => setConfirmation(event.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full flex items-center justify-center gap-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white font-semibold rounded-xl py-2.5 text-sm transition"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan…</>
              : <><KeyRound className="w-4 h-4" /> Simpan password baru</>
            }
          </button>

          <p className="text-center text-xs text-gray-500 mt-1">
            <Link to="/login" className="inline-flex items-center gap-1 text-amber-700 font-semibold hover:underline">
              <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke login
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
