// Build with npm run build:css. Stay on v3 unless the page is checked for styling changes.
module.exports = {
  content: ['./public/index.html', './public/app.js', './public/strip.js'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#111827' },
        secondary: { DEFAULT: '#6B7280' },
        surface: { DEFAULT: '#F9FAFB', muted: '#F3F4F6' }
      }
    }
  }
};
