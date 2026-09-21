import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Navbar   from './components/Navbar'
import Home     from './components/Home'
import Login    from './pages/Login'
import Register from './pages/Register'
import Reader      from './pages/Reader'
import ContentList from './pages/ContentList'
import Dashboard   from './pages/Dashboard'
import SearchResults from './pages/SearchResults'
import AdminUpload from './pages/AdminUpload'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <Routes>
          <Route path="/"         element={<Home />} />
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/search"    element={<SearchResults />} />
          <Route path="/admin"     element={<AdminUpload />} />
          <Route path="/read/:contentId" element={<Reader />} />
          <Route path="/field/:fieldId" element={<ContentList />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}


