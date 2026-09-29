import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { apiFetch } from '../lib/api'

const GENERIC_MESSAGE = 'Jika email terdaftar, instruksi reset password akan dikirim. Periksa inbox dan folder spam.'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)
    try {
      await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      })
      setSuccess(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-orange-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-orange-100 overflow-hidden">
        <div className="bg-gradient-to-r from-amber-800 to-orange-700 px-6 py-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 mb-3">
            <KeyRound className="w-7 h-7 text-amber-800" />
          </div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Lupa Password?</h1>
          <p className="text-amber-200 text-sm mt-1">Kami akan membantu memulihkan akunmu</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-7 flex flex-col gap-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm" role="status">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{GENERIC_MESSAGE}</span>
            </div>
          )}

          <p className="text-sm leading-relaxed text-gray-600">
            Masukkan email akunmu. Jika email terdaftar, kami akan mengirimkan instruksi reset password.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="kamu@email.com"
              className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full flex items-center justify-center gap-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white font-semibold rounded-xl py-2.5 text-sm transition"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengirim…</>
              : <><KeyRound className="w-4 h-4" /> Kirim instruksi reset</>
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
