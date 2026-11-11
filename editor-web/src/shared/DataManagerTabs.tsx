import { Tab, Tabs } from '@mui/material';

export type DataManagerSection = 'datasets' | 'upload' | 'jobs';
type Props = { value: DataManagerSection; onChange: (value: DataManagerSection) => void; prefix: string; datasets: number; jobs: number };

export function DataManagerTabs({ value, onChange, prefix, datasets, jobs }: Props) {
  return <Tabs value={value} onChange={(_, next: DataManagerSection) => onChange(next)} variant="fullWidth" aria-label="Quản lý dữ liệu"
    sx={{ px: { xs: 0, sm: 2 }, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
    <Tab value="datasets" label={`Đã nhập (${datasets})`} id={`${prefix}-tab-datasets`} aria-controls={`${prefix}-panel-datasets`} />
    <Tab value="upload" label="Nhập dữ liệu" id={`${prefix}-tab-upload`} aria-controls={`${prefix}-panel-upload`} />
    <Tab value="jobs" label={`Tác vụ (${jobs})`} id={`${prefix}-tab-jobs`} aria-controls={`${prefix}-panel-jobs`} />
  </Tabs>;
}
