import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Diimpor paling awal: inisialisasi sekali per load, di luar render React.
import './lib/appInsights'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
