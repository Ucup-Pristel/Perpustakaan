import { useEffect, useState } from 'react'

export default function App() {
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('http://103.49.238.85/api/fields')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(json => setFields(json.data ?? []))
      .catch(e => setError(`Gagal memuat data: ${e}`))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-indigo-700 text-white py-6 px-8 shadow">
        <h1 className="text-2xl font-bold tracking-tight">📚 Perpustakaan Digital</h1>
        <p className="text-indigo-200 text-sm mt-1">Kompas Karier &amp; Minat — ucup-edu-lib</p>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <h2 className="text-xl font-semibold text-gray-700 mb-4">Daftar Bidang</h2>

        {loading && <p className="text-gray-500">Memuat data...</p>}
        {error   && <p className="text-red-500">{error}</p>}

        {!loading && !error && (
          <div className="overflow-x-auto rounded-lg shadow">
            <table className="w-full text-sm text-left bg-white">
              <thead className="bg-indigo-50 text-indigo-700 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Nama</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Deskripsi</th>
                  <th className="px-4 py-3">Urutan</th>
                  <th className="px-4 py-3">Aktif</th>
                </tr>
              </thead>
              <tbody>
                {fields.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Tidak ada data</td></tr>
                ) : fields.map((f, i) => (
                  <tr key={f.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 text-gray-500">{f.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {f.icon && <span className="mr-1">{f.icon}</span>}{f.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-500">{f.slug}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{f.description ?? '—'}</td>
                    <td className="px-4 py-3 text-center">{f.sort_order}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${f.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {f.is_active ? 'Ya' : 'Tidak'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

