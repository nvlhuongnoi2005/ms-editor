import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
const App = lazy(() => import('./App'));
const EncPreview = lazy(() => import('./domains/enc/EncPreview').then(module => ({ default: module.EncPreview })));

const theme = createTheme({
  palette: {
    primary: { main: '#a51f38', dark: '#7d172a', light: '#f3d8de', contrastText: '#ffffff' },
    secondary: { main: '#ca5869' },
    error: { main: '#b4233c' },
    success: { main: '#15803d' },
    background: { default: '#edf0f3', paper: '#ffffff' },
    text: { primary: '#1e293b', secondary: '#64748b' },
    divider: '#e2e8f0'
  },
  shape: { borderRadius: 7 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    button: { fontSize: '0.75rem', fontWeight: 750, letterSpacing: '0.01em', textTransform: 'none' }
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 36, borderRadius: 7, transition: 'background-color 160ms ease, color 160ms ease, border-color 160ms ease, box-shadow 160ms ease' },
        sizeSmall: { minHeight: 32 },
        outlined: { borderColor: '#cbd5e1' }
      }
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 7, transition: 'background-color 160ms ease, color 160ms ease, box-shadow 160ms ease' } }
    },
    MuiPaper: {
      styleOverrides: { outlined: { borderColor: '#e2e8f0' } }
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { borderRadius: 6, backgroundColor: '#1e293b', fontSize: '0.6875rem', fontWeight: 650, padding: '6px 8px' } }
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 14, border: '1px solid #e2e8f0', boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)' } }
    },
    MuiTextField: {
      defaultProps: { size: 'small' }
    }
  }
});
const mode = new URLSearchParams(window.location.search).get('mode');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}><Suspense fallback={<p role="status">Đang mở bản đồ…</p>}>{mode === 'enc' ? <EncPreview /> : <App />}</Suspense></ThemeProvider>
  </StrictMode>
);
