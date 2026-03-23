/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        th: {
          'bg':             'var(--color-bg-surface)',
          'bg-alt':         'var(--color-bg-surface-alt)',
          'bg-muted':       'var(--color-bg-muted)',
          'bg-media':       'var(--color-bg-media)',
          'grad-from':      'var(--color-bg-base)',
          'grad-to':        'var(--color-bg-base-to)',
          'text':           'var(--color-text)',
          'text-sub':       'var(--color-text-sub)',
          'text-dim':       'var(--color-text-dim)',
          'text-faint':     'var(--color-text-faint)',
          'border':         'var(--color-border)',
          'border-light':   'var(--color-border-light)',
          'border-lighter': 'var(--color-border-lighter)',
          'btn':            'var(--color-btn)',
          'btn-hover':      'var(--color-btn-hover)',
          'btn-text':       'var(--color-btn-text)',
          'btn-disabled':   'var(--color-btn-disabled)',
          'ring':           'var(--color-ring)',
          'progress':       'var(--color-progress)',
          'progress-fill':  'var(--color-progress-fill)',
        },
      },
    },
  },
  plugins: [],
};
