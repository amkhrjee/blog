/** @type {import('tailwindcss').Config} */
module.exports = {
  daisyui: {
    themes: ["lemonade", "dark"],
  },
  content: ["./*.html"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["IBM Plex Serif"],
        sans: ["Inter Tight"],
        mono: ["Azeret Mono"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography"), require("daisyui")],
};
