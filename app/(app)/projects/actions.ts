'use server';

/**
 * Server actions for projects.
 *
 * Server actions are public endpoints — Next exposes each one at a generated URL. They therefore
 * repeat authentication and validation exactly as a route handler would; being "called from a
 * component" is not a security property.
 */
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { requireUserApi } from '@/auth/guard';
import { createProject } from '@/server/projects';
import { clientIp } from '@/lib/request';

const NewProject = z.object({
  name: z.string().trim().min(2, 'Give the project a name of at least 2 characters.').max(120),
  description: z.string().trim().max(2000).optional(),
});

export interface ActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUserApi();

  const parsed = NewProject.safeParse({
    name: formData.get('name'),
    description: formData.get('description') || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const h = await headers();
  const { id } = await createProject(user, parsed.data, { ip: clientIp(h) });
  redirect(`/projects/${id}/data`);
}
