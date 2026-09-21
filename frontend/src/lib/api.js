// Base URL backend API — dev pakai proxy Vite (relatif), production default ke domain API asli
export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '' : 'https://api.edulib.id')
