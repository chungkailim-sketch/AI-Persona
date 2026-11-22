'use client';

import { useActionState, useRef } from 'react';
import { clearBrandTemplateAction, saveBrandTemplateAction } from '../journeyActions';
import type { FormState } from '../actions';

const empty: FormState = {};
const BTN = 'inline-flex items-center rounded-full border border-line-strong px-4 py-1.5 text-[13px] font-medium text-ink hover:border-brand';

/**
 * Export the report deck (PowerPoint or PDF, in the chosen language and brand), and apply a client
 * brand template so the deck follows the client's guideline.
 */
export function ReportExportBar({
  projectId,
  lang,
  brand,
  canEdit,
}: {
  projectId: string;
  lang: string;
  brand: { name: string; fileName: string; colors: string[]; fonts: string[]; hasLogo: boolean } | null;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveBrandTemplateAction, empty);
  const [cleared, clear, clearing] = useActionState(clearBrandTemplateAction, empty);
  const form = useRef<HTMLFormElement>(null);
  const href = (format: string) => `/projects/${projectId}/report?lang=${lang}&export=${format}`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-semibold text-ink">Download the report</span>
        <a href={href('pptx')} target="_blank" rel="noopener" className={BTN}>PowerPoint (.pptx)</a>
        <a href={href('pdf')} target="_blank" rel="noopener" className={BTN}>PDF</a>
        <span className="text-xs text-ink-subtle">In the language shown, with the brand template below if one is applied.</span>
      </div>
      {canEdit && (
        <form ref={form} action={action} className="flex flex-col gap-2 border-t border-line pt-3">
          <input type="hidden" name="projectId" value={projectId} />
          <p className="text-sm font-semibold text-ink">Brand template</p>
          <p className="max-w-prose text-xs text-ink-subtle">
            Upload the client&rsquo;s PowerPoint template (.pptx, .potx) or theme (.thmx): its colours and fonts are applied to every slide, the PDF and the PowerPoint export. Add a logo to replace the Ruder Finn and rf.AI Persona logos.
          </p>
          {brand && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink">
              <span>{`Applied: ${brand.name}`}</span>
              <span className="flex gap-1" aria-hidden>{brand.colors.map((c) => <span key={c} className="inline-block h-3.5 w-3.5 rounded-sm border border-line" style={{ background: c }} />)}</span>
              {brand.fonts.length > 0 && <span className="text-ink-subtle">{brand.fonts.join(' / ')}</span>}
              {brand.hasLogo && <span className="text-ink-subtle">· logo</span>}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              <span>Template (.pptx, .potx, .thmx)</span>
              <input type="file" name="template" accept=".pptx,.potx,.thmx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              <span>Logo (optional: PNG, JPG, SVG)</span>
              <input type="file" name="logo" accept=".png,.jpg,.jpeg,.svg,.webp,.gif" className="text-xs" />
            </label>
            <button type="submit" disabled={pending} className="rounded-full bg-action px-4 py-1.5 text-[13px] font-medium text-action-ink disabled:opacity-60">
              {pending ? 'Applying…' : brand ? 'Replace' : 'Apply to the report'}
            </button>
            {brand && (
              <button type="submit" formAction={clear} disabled={clearing} className="text-xs font-medium text-danger underline-offset-2 hover:underline">
                Remove template
              </button>
            )}
          </div>
          {[state, cleared].map((s, i) => (
            <span key={i}>
              {s.ok && <p role="status" className="text-xs text-ok">{s.ok}</p>}
              {s.error && <p role="alert" className="text-xs text-danger">{s.error}</p>}
              {s.problems?.map((p) => <p key={p} role="alert" className="text-xs text-danger">{p}</p>)}
            </span>
          ))}
        </form>
      )}
    </div>
  );
}
