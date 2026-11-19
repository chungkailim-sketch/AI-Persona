'use client';

import { RecordActions } from '@/ui/records/RecordActions';
import { manageDebateAction } from '../actions';

/** Edit, re-run, download and delete on one recent debate. */
export function DebateRecordActions({ projectId, debateId, status, base }: { projectId: string; debateId: string; status: string; base: 'personas' | 'advanced/personas' }) {
  return (
    <div className="px-3.5 pb-2">
      <RecordActions
        action={manageDebateAction}
        projectId={projectId}
        recordId={debateId}
        status={status}
        editHref={`/projects/${projectId}/${base}?edit=${debateId}#debate`}
        downloadHref={`/api/projects/${projectId}/debates/${debateId}/md`}
        canManage
        hidden={base === 'personas' ? { returnTo: 'journey' } : undefined}
        noun="debate"
      />
    </div>
  );
}
