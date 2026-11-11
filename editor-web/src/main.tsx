import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from './shared/theme';
import './shared/workspace.css';
import { ModeSelection } from './shared/ModeSelection';
const App = lazy(() => import('./App'));
const EncPreview = lazy(() => import('./domains/enc/EncPreview').then(module => ({ default: module.EncPreview })));

const mode = new URLSearchParams(window.location.search).get('mode');
document.title = mode === 'enc' ? 'ENC · Geodata WebGIS' : mode === 'osm' ? 'OSM · Geodata WebGIS' : 'Geodata WebGIS';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}><Suspense fallback={<p className="workspace-loading" role="status">Đang mở bản đồ…</p>}>{mode === 'enc' ? <EncPreview /> : mode === 'osm' ? <App /> : <ModeSelection />}</Suspense></ThemeProvider>
  </StrictMode>
);
