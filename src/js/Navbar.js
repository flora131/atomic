/**
 * Navbar component for the James Buckhouse site.
 * Creates the sticky top navigation bar with hash-route links.
 */

// TODO: Implement full navbar with active route highlighting
export function createNavbar() {
  const nav = document.createElement('nav');
  nav.className = 'navbar';

  const links = [
    { label: 'Art', route: '#/' },
    { label: '24-Hour Hotline', route: '#/design' },
    { label: 'Library', route: '#/library' },
    { label: 'Film', route: '#/film' },
    { label: 'Buckhouse', route: '#/about' },
    { label: 'Newsletter', route: 'https://jamesbuckhouse.substack.com/' },
  ];

  links.forEach(({ label, route }) => {
    const a = document.createElement('a');
    a.href = route;
    a.textContent = label;
    nav.appendChild(a);
  });

  return nav;
}

export default createNavbar;
