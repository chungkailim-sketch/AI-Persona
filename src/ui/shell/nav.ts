/**
 * Navigation destinations, in order. The everyday journey lives inside a project; the earlier
 * research tools are grouped under "Advanced". Admin is added only for users who hold `admin.access`.
 */
export const NAV_SECTIONS = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/projects', label: 'Projects', icon: 'folder' },
  { href: '/datasets', label: 'Datasets', icon: 'database', group: 'advanced' as const },
  { href: '/briefs', label: 'Briefs', icon: 'doc', group: 'advanced' as const },
  { href: '/personas', label: 'Personas', icon: 'users', group: 'advanced' as const },
  { href: '/runs', label: 'Simulations', icon: 'play', group: 'advanced' as const },
  { href: '/reports', label: 'Reports', icon: 'chart', group: 'advanced' as const },
  { href: '/presets', label: 'Presets', icon: 'sliders', requires: 'admin' as const, group: 'advanced' as const },
  { href: '/methodology', label: 'Methodology', icon: 'help', group: 'advanced' as const },
  { href: '/settings', label: 'Settings', icon: 'gear' },
] as const;

export const ADMIN_SECTION = { href: '/admin', label: 'Admin', icon: 'shield' } as const;

export function isActive(pathname: string, href: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  // Project workflow pages belong to "Projects".
  return href === '/projects' && pathname.startsWith('/projects/');
}
