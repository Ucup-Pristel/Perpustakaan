import { ApplicationInsights } from '@microsoft/applicationinsights-web'

// URL absolut / protocol-relative, atau path yang berdiri sendiri (awal teks,
// setelah spasi, kutip, kurung, '=' atau '@'), diikuti query string atau fragment.
// Query + fragment dibuang karena bisa membawa rahasia, contoh
// /reset-password?token=<SECRET>. Sengaja tanpa lookbehind: Safari lama gagal
// parse regex lookbehind dan itu akan mematikan seluruh bundle.
const URL_QUERY_OR_FRAGMENT = /((?:https?:)?\/\/[^\s?#"'<>]*|(?:^|[\s("'=@])\/[^\s?#"'<>]*)[?#][^\s"'<>]*/g
// Jaring kedua untuk teks bebas (pesan error dsb.) yang memuat parameter token.
const TOKEN_PARAM = /(token=)[^&\s"'<>#]*/gi

export function sanitizeTelemetryText(text) {
  return text.replace(URL_QUERY_OR_FRAGMENT, '$1').replace(TOKEN_PARAM, '$1[REDACTED]')
}

// Telusuri semua string dalam envelope (baseData, data, tags, ext) karena URL
// muncul di banyak field: uri, refUri, target, name, properties.url, stack, dst.
function scrub(value, seen) {
  if (typeof value === 'string') return sanitizeTelemetryText(value)
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const key of Object.getOwnPropertyNames(value)) {
    try {
      const current = value[key]
      if (typeof current === 'string') {
        const clean = sanitizeTelemetryText(current)
        if (clean !== current) value[key] = clean
      } else if (current && typeof current === 'object') {
        scrub(current, seen)
      }
    } catch {
      // properti read-only: lewati, jangan sampai telemetri merusak app
    }
  }
  return value
}

export function sanitizeTelemetryItem(item) {
  scrub(item, new WeakSet())
  return true
}

function init(connectionString) {
  if (!connectionString) return null
  try {
    const ai = new ApplicationInsights({
      config: {
        connectionString,
        enableAutoRouteTracking: true,
        enableUnhandledPromiseRejectionTracking: true,
        // Default SDK sudah false; dipasang eksplisit karena request membawa
        // header Authorization berisi JWT.
        enableRequestHeaderTracking: false,
        enableResponseHeaderTracking: false,
      },
    })
    ai.loadAppInsights()
    // Initializer berjalan sebelum item masuk buffer/channel, jadi tidak ada
    // URL mentah yang tersimpan di sessionStorage buffer atau terkirim.
    ai.addTelemetryInitializer(sanitizeTelemetryItem)
    ai.trackPageView()
    return ai
  } catch (err) {
    // Telemetri tidak boleh mematikan aplikasi.
    console.warn('Application Insights gagal diinisialisasi', err)
    return null
  }
}

// Dievaluasi sekali per load halaman (ES module), aman dari render ulang /
// StrictMode. null bila connection string tidak diset.
export const appInsights = init(import.meta.env.VITE_APPLICATIONINSIGHTS_CONNECTION_STRING)
