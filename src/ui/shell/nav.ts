/** Navigation destinations, in order. Admin is added only for users who hold `admin.access`. */
export const NAV_SECTIONS = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/projects', label: 'Projects', icon: 'folder' },
  { href: '/datasets', label: 'Datasets', icon: 'database' },
  { href: '/briefs', label: 'Briefs', icon: 'doc' },
  { href: '/personas', label: 'Personas', icon: 'users' },
  { href: '/runs', label: 'Simulations', icon: 'play' },
  { href: '/reports', label: 'Reports', icon: 'chart' },
  { href: '/presets', label: 'Presets', icon: 'sliders', requires: 'admin' as const },
  { href: '/settings', label: 'Settings', icon: 'gear' },
] as const;

export const ADMIN_SECTION = { href: '/admin', label: 'Admin', icon: 'shield' } as const;

export function isActive(pathname: string, href: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  // Project workflow pages belong to "Projects".
  return href === '/projects' && pathname.startsWith('/projects/');
}
