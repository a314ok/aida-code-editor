/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0a',
        foreground: '#ededed',
        primary: {
          DEFAULT: '#ffffff',
          foreground: '#000000',
        },
        border: 'rgba(255, 255, 255, 0.1)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Geist Mono', 'monospace'],
        sans: ['Inter', 'Geist Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
