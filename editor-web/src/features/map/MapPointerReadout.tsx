import { useImperativeHandle, useState, type Ref } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import type { MapPointerStatus } from './MapCanvas';

export type MapPointerReadoutHandle = { update: (status: MapPointerStatus) => void };

// Pointer movement updates this small readout without rerendering the editor,
// its feature inspector and the full list of validation issues every frame.
export function MapPointerReadout({ ref }: { ref: Ref<MapPointerReadoutHandle> }) {
  const [status, setStatus] = useState<MapPointerStatus>({ longitude: 104.50728, latitude: 21.59988, zoom: 16 });
  useImperativeHandle(ref, () => ({ update: setStatus }), []);
  return <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mr: { xs: 0, sm: 2 }, display: { xs: 'none', sm: 'flex' } }}>
    <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8' }}>
      {Math.abs(status.latitude).toFixed(5)}° {status.latitude >= 0 ? 'B' : 'N'}, {Math.abs(status.longitude).toFixed(5)}° {status.longitude >= 0 ? 'Đ' : 'T'}
    </Typography>
    <Box sx={{ height: 12, width: '1px', bgcolor: '#334155' }} />
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>Z {status.zoom.toFixed(1)}</Typography>
  </Stack>;
}
