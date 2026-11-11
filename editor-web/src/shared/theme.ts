import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: { main: '#8b2235', dark: '#681626', light: '#f1e1e3', contrastText: '#ffffff' },
    secondary: { main: '#526866' },
    error: { main: '#ac2438' }, success: { main: '#316345' }, warning: { main: '#82551a' },
    background: { default: '#f5f2e9', paper: '#fcfbf7' },
    text: { primary: '#252c2b', secondary: '#626a63' }, divider: '#d4d3c8',
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: 'GeodataSans, sans-serif', fontSize: 13,
    h1: { fontSize: '2.75rem', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-.025em' },
    h2: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.25 },
    h3: { fontSize: '1.125rem', fontWeight: 600 },
    button: { fontSize: '.8125rem', fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
    subtitle2: { fontSize: '.9375rem', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: { styleOverrides: { body: { margin: 0 }, '*': { boxSizing: 'border-box' } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: {
      root: { minHeight: 40, borderRadius: 4 }, sizeSmall: { minHeight: 36 }, outlined: { borderColor: '#b7b9af' },
    } },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 4, minWidth: 36, minHeight: 36 } } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: '#fcfbf7', borderRadius: 4 } } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 6, border: '1px solid #d4d3c8', maxHeight: 'calc(100dvh - 32px)' } } },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: '1.25rem', fontWeight: 600, padding: '20px 24px 16px' } } },
    MuiDialogContent: { styleOverrides: { root: { overscrollBehavior: 'contain' } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '12px 24px', borderTop: '1px solid #d4d3c8', gap: 8, flexWrap: 'wrap' } } },
    MuiMenuItem: { styleOverrides: { root: { minHeight: 44, gap: 8 } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: '#252c2b', borderRadius: 4, fontSize: 12, padding: '6px 10px' } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 4, fontWeight: 600 } } },
    MuiTab: { styleOverrides: { root: { minHeight: 44, fontWeight: 600, textTransform: 'none' } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 4, fontSize: 13 }, message: { minWidth: 0, overflowWrap: 'anywhere' } } },
  },
});
