import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, UserPlus, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { register } = useAuth()
  const navigate     = useNavigate()

  const [fullName,  setFullName]  = useState('')
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState(false)
  const [loading,   setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      return setError('Password minimal 6 karakter')
    }
    setLoading(true)
    try {
      await register(email.trim(), password, fullName.trim())
      setSuccess(true)
      setTimeout(() => navigate('/login', { replace: true }), 1800)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-orange-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-orange-100 overflow-hidden">
        {/* Header strip */}
        <div className="bg-gradient-to-r from-amber-800 to-orange-700 px-6 py-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 mb-3">
            <BookOpen className="w-7 h-7 text-amber-800" />
          </div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Buat Akun</h1>
          <p className="text-amber-200 text-sm mt-1">Kompas Karier &amp; Minat</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-7 flex flex-col gap-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Akun berhasil dibuat! Mengarahkan ke halaman login…</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="fullname">Nama Lengkap</label>
            <input
              id="fullname"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Budi Santoso"
              className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="kamu@email.com"
              className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="password">
              Password <span className="font-normal text-gray-400">(min. 6 karakter)</span>
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading || success}
            className="mt-1 w-full flex items-center justify-center gap-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white font-semibold rounded-xl py-2.5 text-sm transition"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Memproses…</>
              : <><UserPlus className="w-4 h-4" /> Daftar</>
            }
          </button>

          <p className="text-center text-xs text-gray-500 mt-1">
            Sudah punya akun?{' '}
            <Link to="/login" className="text-amber-700 font-semibold hover:underline">Masuk di sini</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
