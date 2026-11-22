/** Saving and clearing a project's report brand template (server only). */
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';
import { readBrandTemplate, BrandTemplateRefused, type BrandTheme } from './brandTheme';

const TEMPLATE_MAX = 40 * 1024 * 1024;
const LOGO_MAX = 1024 * 1024;
const LOGO_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' };

export async function projectBrand(projectId: string): Promise<BrandTheme | null> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { brandTheme: true } });
  return (p?.brandTheme as unknown as BrandTheme | null) ?? null;
}

export async function saveBrandTemplate(
  user: SessionUser,
  projectId: string,
  template: { name: string; bytes: Buffer } | null,
  logo: { name: string; bytes: Buffer } | null,
): Promise<BrandTheme> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  const current = await projectBrand(projectId);
  if (!template && !current) throw new BrandTemplateRefused('Choose a PowerPoint template (.pptx, .potx) or theme (.thmx).');
  if (template && template.bytes.length > TEMPLATE_MAX) throw new BrandTemplateRefused('The template is larger than 40 MB.');
  let logoUrl = current?.logo ?? null;
  if (logo) {
    const ext = logo.name.split('.').pop()?.toLowerCase() ?? '';
    const type = LOGO_TYPES[ext];
    if (!type) throw new BrandTemplateRefused('The logo must be a PNG, JPG, WebP, GIF or SVG image.');
    if (logo.bytes.length > LOGO_MAX) throw new BrandTemplateRefused('The logo is larger than 1 MB.');
    logoUrl = `data:${type};base64,${logo.bytes.toString('base64')}`;
  }
  const theme = template ? await readBrandTemplate(template.bytes, template.name) : current!;
  const saved: BrandTheme = { ...theme, logo: logoUrl, uploadedAt: new Date().toISOString() };
  await prisma.project.update({ where: { id: projectId }, data: { brandTheme: saved as unknown as object } });
  await recordAudit({ action: 'project.brand.saved', targetType: 'project', targetId: projectId, projectId, actorUserId: user.userId, actorEmail: user.email, reason: `Report brand template: ${saved.fileName}${logo ? ' (with logo)' : ''}` });
  return saved;
}

export async function clearBrandTemplate(user: SessionUser, projectId: string): Promise<void> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  await prisma.project.update({ where: { id: projectId }, data: { brandTheme: Prisma.DbNull } });
  await recordAudit({ action: 'project.brand.saved', targetType: 'project', targetId: projectId, projectId, actorUserId: user.userId, actorEmail: user.email, reason: 'Report brand template removed: back to the Ruder Finn design' });
}
