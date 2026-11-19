'use client';

import { RecordActions } from '@/ui/records/RecordActions';
import { managePlanAction } from '../journeyActions';

/** Edit, re-run, download and delete on one written plan. */
export function PlanRecordActions({ projectId, planId, status, canManage }: { projectId: string; planId: string; status: string; canManage: boolean }) {
  return (
    <RecordActions
      action={managePlanAction}
      projectId={projectId}
      recordId={planId}
      status={status}
      editHref={`/projects/${projectId}/results?editPlan=${planId}#plans`}
      downloadHref={`/api/projects/${projectId}/plans/${planId}/md`}
      canManage={canManage}
      noun="plan"
    />
  );
}
