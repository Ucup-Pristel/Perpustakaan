import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, matchPath } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import Career from './pages/Career'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'

// Reader menarik react-pdf + pdf.worker (bagian terbesar bundle) dan hanya dipakai
// di satu route. Dipisah lewat lazy() supaya halaman awal tidak ikut mengunduhnya.
// Landing memuat framer-motion untuk animasi hero. Halaman aplikasi lain
// memuatnya hanya bila memang memakai animasi.
const Landing = lazy(() => import('./pages/Landing'))
const Library = lazy(() => import('./pages/Library'))
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

// Landing (route "/") punya navigasi sendiri; halaman aplikasi memakai Navbar aplikasi.
// Memakai matchPath, bukan cek pathname mentah, supaya `/library` tidak ikut.
const APP_ROUTES = ['/library', '/karier', '/login', '/register', '/forgot-password', '/reset-password', '/search', '/read/:contentId', '/field/:fieldId', '/dashboard', '/admin']

function AppShell() {
  const { pathname } = useLocation()
  const isAppRoute = APP_ROUTES.some(pattern => matchPath(pattern, pathname))

  return (
    <>
      {isAppRoute && <Navbar />}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/library" element={<Library />} />
          <Route path="/karier" element={<Career />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/read/:contentId" element={<Reader />} />
          <Route path="/field/:fieldId" element={<ContentList />} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth adminOnly><AdminUpload /></RequireAuth>} />
          {/* Tanpa ini, URL salah hanya menampilkan navbar dan halaman kosong. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  )
}
