// Tailwind v4 is a PostCSS plugin and takes no JS config: the design tokens live
// in CSS (src/app/globals.css) via @theme, which is why there is no
// tailwind.config.ts in this repository.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
