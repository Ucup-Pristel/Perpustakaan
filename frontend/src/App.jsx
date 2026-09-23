import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import Home from './components/Home'
import Login from './pages/Login'
import Register from './pages/Register'

// Reader menarik react-pdf + pdf.worker (bagian terbesar bundle) dan hanya dipakai
// di satu route. Dipisah lewat lazy() supaya halaman awal tidak ikut mengunduhnya.
const Reader = lazy(() => import('./pages/Reader'))
const ContentList = lazy(() => import('./pages/ContentList'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const SearchResults = lazy(() => import('./pages/SearchResults'))
const AdminUpload = lazy(() => import('./pages/AdminUpload'))

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
      <span className="sr-only">Memuat halaman…</span>
    </div>
  )
}

/**
 * Guard route. `adminOnly` menyembunyikan UI dari non-admin — backend tetap
 * penegak izin sebenarnya (auth + isAdmin), ini hanya supaya pengguna tidak
 * melihat backoffice lalu ditolak setiap aksinya.
 * Lokasi asal disimpan supaya setelah login pengguna kembali ke tujuannya.
 */
function RequireAuth({ children, adminOnly = false }) {
  const { isAuthenticated, isAdmin } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (adminOnly && !isAdmin) {
    return (
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-amber-900">Akses ditolak</h1>
        <p className="mt-2 text-sm text-gray-600">Halaman ini hanya untuk admin.</p>
        <Link to="/" className="mt-4 inline-block text-sm font-semibold text-amber-700 hover:underline">
          Kembali ke beranda
        </Link>
      </main>
    )
  }
  return children
}

function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-2xl font-bold text-amber-900">Halaman tidak ditemukan</h1>
      <p className="mt-2 text-sm text-gray-600">Alamat yang kamu buka tidak tersedia.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-semibold text-amber-700 hover:underline">
        Kembali ke beranda
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/search" element={<SearchResults />} />
            <Route path="/read/:contentId" element={<Reader />} />
            <Route path="/field/:fieldId" element={<ContentList />} />
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth adminOnly><AdminUpload /></RequireAuth>} />
            {/* Tanpa ini, URL salah hanya menampilkan navbar dan halaman kosong. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
