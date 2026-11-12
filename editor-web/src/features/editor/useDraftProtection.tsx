import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { capturePendingTags, pendingChanges, useEditorStore, type EditorState } from './EditorStore';
import type { Tags } from '../../types/osm';
import { compactDraftState, readDraft, validateDraft, writeDraft, type DraftRecord, type DraftWorkspace } from './drafts';
import { closeChangeset, getChangeset, toUploadChanges, uploadChangeset } from '../../api/changeset';

export function useDraftProtection({ dataset, busy, unfinished, workspace, workspaceToken, pendingTags, onRestore }: {
  dataset: string;
  busy: boolean;
  unfinished: boolean;
  workspace: () => DraftWorkspace;
  workspaceToken: object;
  pendingTags?: { key: string; tags: Tags } | null;
  onRestore: (state: EditorState, workspace?: DraftWorkspace) => void | Promise<void>;
}) {
  const { draftToken, getDraftState, restoreDraftState, discardChanges, changeCount } = useEditorStore();
  const [phase, setPhase] = useState<'loading' | 'prompt' | 'ready' | 'unavailable' | 'manager' | 'recovery'>('loading');
  const [candidate, setCandidate] = useState<DraftRecord | null>(null);
  const [status, setStatus] = useState('Đang kiểm tra bản nháp…');
  const [error, setError] = useState<string | null>(null);
  const expected = useRef<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  const pendingTagsRef = useRef(pendingTags); pendingTagsRef.current = pendingTags;
  const snapshotState = useCallback(() => capturePendingTags(getDraftState(), pendingTagsRef.current), [getDraftState]);
  const pendingUpload = useRef<string | undefined>(undefined);
  const raw = useRef<unknown>(null);
  const [working, setWorking] = useState(false);
  const disabledStorage = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void readDraft(dataset).then(value => {
      if (cancelled) return;
      if (value) {
        raw.current = value;
        const draft = validateDraft(value, dataset);
        expected.current = draft.revision;
        pendingUpload.current = draft.pendingUpload;
        setCandidate(draft); setPhase(draft.pendingUpload ? 'recovery' : 'prompt'); setStatus('Có bản nháp chờ khôi phục');
      } else { setPhase('ready'); setStatus('Chưa có thay đổi cần lưu nháp'); }
    }).catch(reason => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : 'Không đọc được kho nháp trên máy.'); setPhase('unavailable');
    });
    return () => { cancelled = true; alive.current = false; };
  }, [dataset]);

  const persist = useCallback(() => {
    const workspace = structuredClone(workspaceRef.current());
    const snapshot = compactDraftState(snapshotState(), workspace);
    const hasWork = Object.keys(snapshot.overrides).length > 0 || snapshot.undoStack.length > 0 || snapshot.redoStack.length > 0 || workspace.vertices.length > 0;
    const record: DraftRecord | null = hasWork ? { schema: 1, dataset, revision: crypto.randomUUID(), savedAt: Date.now(), state: snapshot, workspace, ...(pendingUpload.current ? { pendingUpload: pendingUpload.current } : {}) } : null;
    if (disabledStorage.current) return Promise.reject(new Error('Lưu nháp đang tắt. Hãy xuất bản sao công việc trước khi rời trang.'));
    if (alive.current) setStatus(hasWork ? 'Đang lưu nháp trên máy…' : 'Đang cập nhật kho nháp…');
    const job = queue.current.then(async () => {
      await writeDraft(dataset, expected.current, record);
      expected.current = record?.revision ?? null;
      if (alive.current) { setError(null); setStatus(record ? `Đã lưu nháp trên máy · ${new Date(record.savedAt).toLocaleTimeString('vi-VN')}` : 'Không có thay đổi cần lưu nháp'); }
    });
    // A rejected write stops this queue. Never overwrite another tab after a conflict.
    queue.current = job.catch(() => undefined);
    void job.catch(reason => { if (alive.current) { setError(reason instanceof Error ? reason.message : 'Không lưu được nháp. Kiểm tra dung lượng trình duyệt.'); setStatus('Chưa lưu được nháp trên máy'); } });
    return job;
  }, [dataset, snapshotState]);

  useEffect(() => {
    if (phase !== 'ready' || disabledStorage.current) return;
    setStatus('Đang chờ lưu nháp trên máy…');
    const timer = window.setTimeout(() => { void persist().catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
  }, [draftToken, workspaceToken, phase, persist]);

  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden' && phase === 'ready' && !disabledStorage.current) void persist().catch(() => undefined); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [persist, phase]);

  useEffect(() => {
    if (!changeCount && !unfinished && !busy) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [busy, changeCount, unfinished]);

  const restore = async () => {
    if (!candidate) return;
    setWorking(true);
    try {
      restoreDraftState(candidate.state); await onRestore(candidate.state, candidate.workspace); setCandidate(null); setPhase('ready');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không khôi phục được nháp.'); }
    finally { setWorking(false); }
  };
  const discard = async () => {
    if (!candidate) return;
    setWorking(true);
    try {
      await writeDraft(dataset, expected.current, null); expected.current = null;
      setCandidate(null); setPhase('ready');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không xóa được nháp.'); }
    finally { setWorking(false); }
  };
  const exportBackup = () => {
    const value = phase === 'unavailable' && raw.current ? raw.current : candidate ?? { schema: 1, dataset, revision: crypto.randomUUID(), savedAt: Date.now(), state: compactDraftState(snapshotState(), workspaceRef.current()), workspace: workspaceRef.current(), ...(pendingUpload.current ? { pendingUpload: pendingUpload.current } : {}) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `map-editor-draft-${Date.now()}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const recoverUpload = async () => {
    const saved = candidate;
    if (!saved?.pendingUpload) return;
    setWorking(true); setError(null);
    try {
      let result = await getChangeset(saved.pendingUpload);
      if (result.committedRevision === undefined && result.status === 'closed') {
        throw new Error('Phiên thay đổi chưa xác nhận commit. Phiên đã đóng nhưng chưa lưu dữ liệu. Bản nháp được giữ nguyên; xuất bản sao JSON để đối soát.');
      }
      // Retry only the SAME changeset and immutable payload. The backend locks
      // its row and refuses a second commit, including an in-flight first try.
      if (!result.committedRevision && result.status === 'open') {
        try { result = await uploadChangeset(saved.pendingUpload, toUploadChanges(pendingChanges(saved.state))); }
        catch (uploadError) {
          result = await getChangeset(saved.pendingUpload);
          if (result.committedRevision === undefined) throw new Error(`Phiên thay đổi chưa xác nhận commit. ${uploadError instanceof Error ? uploadError.message : 'Lỗi kết nối.'} Bản nháp được giữ nguyên.`);
        }
      }
      if (!result.committedRevision) throw new Error('Phiên thay đổi chưa xác nhận commit. Bản nháp được giữ nguyên; kiểm tra lại kết nối hoặc xuất bản sao để đối soát.');
      await writeDraft(dataset, expected.current, null); expected.current = null;
      pendingUpload.current = undefined; setCandidate(null); discardChanges(); setPhase('ready'); setStatus('Đã xác nhận phiên lưu trên hệ thống');
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không kiểm tra được phiên lưu.'); }
    finally { setWorking(false); }
  };
  const resumeEditing = async () => {
    if (!candidate?.pendingUpload) return;
    setWorking(true);
    try {
      // Closing serializes against any in-flight upload on the server. A closed
      // uncommitted session cannot later commit behind a restored draft.
      let result;
      try { result = await closeChangeset(candidate.pendingUpload); }
      catch { result = await getChangeset(candidate.pendingUpload); }
      if (result.committedRevision) { await recoverUpload(); return; }
      if (result.status !== 'closed') throw new Error('Chưa đóng được phiên lưu. Không thể chỉnh sửa an toàn lúc này.');
      pendingUpload.current = undefined;
      const next = { ...candidate, pendingUpload: undefined, revision: crypto.randomUUID() };
      await writeDraft(dataset, expected.current, next); expected.current = next.revision;
      setCandidate(next); setError(null); setPhase('prompt');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không đóng được phiên lưu.'); }
    finally { setWorking(false); }
  };
  const prepareUpload = useCallback(async (id: string) => { pendingUpload.current = id; if (!disabledStorage.current) await persist(); }, [persist]);
  const rejectedUpload = useCallback(() => { pendingUpload.current = undefined; void persist().catch(() => undefined); }, [persist]);
  const confirmedUpload = useCallback(() => { pendingUpload.current = undefined; }, []);
  const suspendForRecovery = useCallback(() => {
    if (!pendingUpload.current) return;
    const record: DraftRecord = { schema: 1, dataset, revision: expected.current ?? '', savedAt: Date.now(), state: compactDraftState(getDraftState(), workspaceRef.current()), workspace: workspaceRef.current(), pendingUpload: pendingUpload.current };
    setCandidate(record); setPhase('recovery');
  }, [dataset, getDraftState]);
  const blocked = phase !== 'ready';
  const dialog = <Dialog open={blocked} maxWidth="sm" fullWidth aria-labelledby="draft-title">
    <DialogTitle id="draft-title">{phase === 'loading' ? 'Kiểm tra công việc trước đó' : phase === 'prompt' ? 'Khôi phục công việc chưa lưu?' : phase === 'manager' ? 'Bảo vệ công việc' : phase === 'recovery' ? 'Kiểm tra phiên lưu bị gián đoạn' : 'Không truy cập được bản nháp'}</DialogTitle>
    <DialogContent>
      <Stack spacing={2}>
        <input ref={importInput} hidden type="file" accept="application/json,.json" aria-label="Nhập bản sao nháp JSON" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          if (file.size > 50 * 1024 * 1024) { setError('Bản sao vượt quá 50 MB. Không thay đổi công việc hiện tại.'); return; }
          void file.text().then(text => {
            const imported = validateDraft(JSON.parse(text), dataset);
            setCandidate(imported); pendingUpload.current = imported.pendingUpload;
            setPhase(imported.pendingUpload ? 'recovery' : 'prompt'); setError(null);
          }).catch(() => setError('Không nhập được bản sao: tệp không hợp lệ, khác phiên bản hoặc khác bộ dữ liệu.'));
        }} />
        {phase === 'loading' && <Typography>Đang đọc bản nháp trên trình duyệt này…</Typography>}
        {phase === 'manager' && <><Typography>{status}</Typography><Typography variant="body2">Nháp chỉ nằm trên trình duyệt này. Xóa dữ liệu trình duyệt sẽ xóa nháp. Có thể xuất JSON để giữ thêm một bản sao.</Typography></>}
        {phase === 'recovery' && <Alert severity="warning">Phiên thay đổi chưa xác nhận commit. Bản nháp được giữ nguyên; kiểm tra lại kết nối hoặc xuất bản sao để đối soát.</Alert>}
        {candidate && <>
          <Typography sx={{ overflowWrap: 'anywhere' }}>{dataset} · {new Date(candidate.savedAt).toLocaleString('vi-VN')}</Typography>
          <Typography>{Object.keys(candidate.state.overrides).length} thay đổi · {candidate.workspace?.vertices.length ?? 0} đỉnh đang vẽ. Khôi phục giữ nguyên tọa độ, liên kết và lịch sử Undo/Redo.</Typography>
          {phase !== 'recovery' && <Alert severity="info">Đây là bản nháp trên máy, chưa phải dữ liệu đã lưu vào hệ thống. Phiên bản server vẫn được kiểm tra khi lưu.</Alert>}
        </>}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
      {phase !== 'loading' && <Button disabled={working} onClick={exportBackup}>Xuất bản sao JSON</Button>}
      {phase === 'prompt' && <><Button disabled={working} onClick={() => void discard()}>Xóa bản nháp</Button><Button disabled={working} variant="contained" onClick={() => void restore()}>{working ? 'Đang kiểm tra phiên bản…' : 'Khôi phục bản nháp'}</Button></>}
      {phase === 'manager' && <><Button disabled={working || changeCount > 0 || unfinished || busy} onClick={() => importInput.current?.click()}>Nhập bản sao JSON</Button><Button disabled={working || disabledStorage.current} onClick={() => void persist().catch(() => undefined)}>Thử lưu nháp lại</Button><Button onClick={() => setPhase('ready')}>Đóng</Button></>}
      {phase === 'recovery' && <><Button disabled={working} onClick={() => void resumeEditing()}>Đóng phiên chưa lưu để sửa nháp</Button><Button disabled={working} variant="contained" onClick={() => void recoverUpload()}>{working ? 'Đang đối soát…' : 'Kiểm tra / Tiếp tục phiên lưu'}</Button></>}
      {phase === 'unavailable' && <><Button onClick={() => window.location.reload()}>Thử lại</Button><Button onClick={() => { disabledStorage.current = true; setPhase('ready'); setStatus('Lưu nháp chưa khả dụng'); }}>Tiếp tục, chưa có bảo vệ nháp</Button></>}
    </DialogActions>
  </Dialog>;
  return { blocked, status, error, dialog, persist, open: () => setPhase('manager'), prepareUpload, rejectedUpload, confirmedUpload, suspendForRecovery };
}
