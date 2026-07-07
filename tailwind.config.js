
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
    "./services/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hud: {
          bg: "#020810",
          panel: "#04121f",
          cyan: "#22d3ee",
          cyanBright: "#67e8f9",
          gold: "#f59e0b",
          dim: "#164e63",
        },
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        data: ['"Share Tech Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
