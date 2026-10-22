import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import App from './App';

const theme = createTheme({
  palette: {
    primary: { main: '#a51f38', dark: '#7d172a', light: '#f3d8de', contrastText: '#ffffff' },
    secondary: { main: '#ca5869' },
    background: { default: '#edf0f3', paper: '#ffffff' }
  },
  shape: { borderRadius: 7 },
  typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }
});
createRoot(document.getElementById('root')!).render(<StrictMode><ThemeProvider theme={theme}><App /></ThemeProvider></StrictMode>);
