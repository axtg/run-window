// Build with npm run build:css. Stay on v3 unless the page is checked for styling changes.
module.exports = {
  content: ['./public/index.html', './public/app.js', './public/strip.js'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#111827' },
        secondary: { DEFAULT: '#6B7280' },
        surface: { DEFAULT: '#F9FAFB', muted: '#F3F4F6' }
      },
      // #weather-fx: two layers of drops or flakes, moved by one tile of each layer per cycle so the loop is seamless
      keyframes: {
        rain: {
          from: { backgroundPosition: '0 0, 0 0, 0 0' },
          to: { backgroundPosition: '-23px 97px, -37px 131px, -53px 173px' }
        },
        snow: {
          from: { backgroundPosition: '0 0, 0 0, 0 0' },
          to: { backgroundPosition: '71px 158px, -97px 226px, 131px 298px' }
        }
      },
      animation: { rain: 'rain 0.9s linear infinite', snow: 'snow 16s linear infinite' }
    }
  }
};
