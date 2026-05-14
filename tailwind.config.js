/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: '#f8f7f4',
        ink: '#1a1a2e',
        accent: '#4a90d9',
      }
    },
  },
  plugins: [],
}
