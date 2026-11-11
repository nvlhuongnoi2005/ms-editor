import { Component, Suspense, type ReactNode } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material';

type Props = { children: ReactNode; onClose: () => void };

// Keep the workspace mounted while an optional tool downloads. Closing a failed
// download must preserve the user's current selection and unsaved edits.
class DialogDownloadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? (
      <Dialog open onClose={this.props.onClose} fullWidth maxWidth="xs" aria-label="Không mở được công cụ">
        <DialogTitle>Không mở được công cụ</DialogTitle>
        <DialogContent><Alert severity="error">Không tải được tài nguyên. Hãy lưu bản nháp trước khi tải lại trang.</Alert></DialogContent>
        <DialogActions><Button onClick={this.props.onClose}>Đóng</Button></DialogActions>
      </Dialog>
    ) : this.props.children;
  }
}

export function DeferredDialog({ children, onClose }: Props) {
  return <DialogDownloadBoundary onClose={onClose}>
    <Suspense fallback={
      <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-label="Đang mở công cụ">
        <DialogContent><Stack direction="row" spacing={2} sx={{ alignItems: 'center' }} role="status"><CircularProgress size={20} /><span>Đang mở công cụ…</span></Stack></DialogContent>
        <DialogActions><Button onClick={onClose}>Đóng</Button></DialogActions>
      </Dialog>
    }>{children}</Suspense>
  </DialogDownloadBoundary>;
}
